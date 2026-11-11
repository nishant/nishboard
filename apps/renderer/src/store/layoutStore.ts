import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layout } from 'react-grid-layout';
import { DEFAULT_LAYOUT, PRESETS, autoFillLayout, applyConstraints, generateLayout, isWidgetId, ALL_WIDGET_IDS, WIDGET_CONSTRAINTS } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';
import { useAppSettingsStore } from './settingsStore';
import { useWidgetUiStore } from './widgetUiStore';

/** WidgetShell header height in px: px-3 py-2 (16px vertical) + ~13px text + 1px
 *  border ≈ 34. Used to compute how few grid rows a collapsed (title-bar-only)
 *  widget needs. */
export const TITLEBAR_PX = 34;

/** WidgetShell header height on touch screens (`pointer-coarse:min-h-11`): the
 *  header grows to fit 44px action hit areas. */
export const COARSE_TITLEBAR_PX = 44;

function headerPx(): number {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    ? COARSE_TITLEBAR_PX
    : TITLEBAR_PX;
}

/** Default grid-row height to restore a collapsed widget to when no prior height
 *  was captured (defensive — savedHeights should normally hold the real value). */
const DEFAULT_EXPAND_H = 6;

/** How many grid rows a collapsed widget needs to show just its title bar, given
 *  the current viewport-derived rowHeight and inter-item gap. rowHeight is small
 *  (many rows) → needs a couple rows; rowHeight large (few rows) → a single row.
 *  Exported for tests. */
export function collapsedRowsFor(rowHeight: number, gap: number): number {
  return Math.max(1, Math.ceil((headerPx() + gap) / (rowHeight + gap)));
}

/** Rows a collapsed tile is locked at when the live rowHeight is unknown (a layout
 *  replaced from inside the store). DashboardGrid patches the exact h on its next
 *  render; setWidgetCollapsed keeps this in step with the last real value. */
let lastCollapsedRows = 2;

/** The widgets that may actually appear: `ids` minus the ones disabled in
 *  Settings. A disabled widget given a layout slot would leave a hole, and as an
 *  accordion neighbour would be gifted rows nobody can see. */
function effectiveVisible(ids: WidgetId[]): WidgetId[] {
  const disabled = useAppSettingsStore.getState().disabledWidgets;
  return ids.filter((id) => !disabled.includes(id));
}

function collapsedIdSet(): Set<string> {
  const flags = useWidgetUiStore.getState().collapsed;
  return new Set(Object.keys(flags).filter((id) => flags[id as WidgetId]));
}

/** Make a replaced layout agree with the collapsed flags (widgetUiStore is the
 *  source of truth): collapsed tiles are locked tiny with their expanded h in
 *  savedHeights; every other tile loses any stale lock. Every wholesale layout
 *  replacement goes through here. `keepSaved` (rehydrate) trusts an existing
 *  savedHeights entry over the item's h, which is already the collapsed one. */
export function normalizeCollapse(
  layout: Layout[],
  collapsedIds: ReadonlySet<string>,
  prevSaved: Partial<Record<WidgetId, number>> = {},
  keepSaved = false,
): { layout: Layout[]; savedHeights: Partial<Record<WidgetId, number>> } {
  const savedHeights: Partial<Record<WidgetId, number>> = {};
  const out = layout.map((item) => {
    const id = item.i as WidgetId;
    const locked = item.isResizable === false;
    if (collapsedIds.has(item.i)) {
      const saved = keepSaved || locked ? (prevSaved[id] ?? (locked ? undefined : item.h)) : item.h;
      if (saved !== undefined) savedHeights[id] = saved;
      const h = lastCollapsedRows;
      return { ...item, h, minH: h, maxH: h, isResizable: false };
    }
    if (!locked && item.maxH === undefined) return item;
    const { maxH: _drop, ...rest } = item;
    void _drop;
    return { ...rest, minH: WIDGET_CONSTRAINTS[id]?.minH ?? rest.minH, isResizable: true };
  });
  return { layout: out, savedHeights };
}

/** A copy of the layout for saving: collapsed tiles go back to their pre-collapse
 *  h with no lock, so applying the layout later never brings back a stuck sliver. */
function unlockedSnapshot(layout: Layout[], savedHeights: Partial<Record<WidgetId, number>>): Layout[] {
  return layout.map((item) => {
    const saved = savedHeights[item.i as WidgetId];
    if (saved === undefined && item.isResizable !== false) return { ...item };
    const { maxH: _drop, isResizable: _lock, ...rest } = item;
    void _drop;
    void _lock;
    return { ...rest, h: saved ?? rest.h, minH: WIDGET_CONSTRAINTS[item.i as WidgetId]?.minH ?? rest.minH };
  });
}

const INITIAL_VISIBLE: WidgetId[] = [...(DEFAULT_LAYOUT.visibleWidgets ?? ALL_WIDGET_IDS)];

/** Find the visible, non-collapsed widgets sitting DIRECTLY below `item`
 *  (`y === item.y + item.h`) that together tile its exact x-span. These are the
 *  accordion partners: collapse gifts them the freed rows, expand steals the rows
 *  back — their bottom edges never move, so the layout stays gap-free, RGL's
 *  vertical compaction is a no-op, and the viewport-derived rowHeight is
 *  untouched. Returns null (→ caller falls back to plain shrink/restore + RGL
 *  reflow) when the row below doesn't qualify:
 *  - nothing visible starts exactly at the item's bottom edge within its span,
 *  - a candidate sticks out past the span (it would corrupt columns outside it),
 *  - the candidates don't tile the span exactly (gap or overlap),
 *  - a candidate is itself collapsed (height-locked — can't give or take rows).
 *  Hidden widgets are ignored entirely — they don't participate in grid geometry.
 *  Exported for tests. */
export function exactNeighborsBelow(
  layout: Layout[],
  visibleWidgets: WidgetId[],
  item: Layout,
  savedHeights: Partial<Record<WidgetId, number>>,
): Layout[] | null {
  const bottom = item.y + item.h;
  const right = item.x + item.w;
  const visible = new Set<string>(visibleWidgets);
  const candidates = layout.filter(
    (it) =>
      it.i !== item.i &&
      visible.has(it.i) &&
      it.y === bottom &&
      it.x < right &&
      it.x + it.w > item.x,
  );
  if (candidates.length === 0) return null;
  for (const n of candidates) {
    if (n.x < item.x || n.x + n.w > right) return null;
    if (savedHeights[n.i as WidgetId] !== undefined || n.isResizable === false) return null;
  }
  const sorted = [...candidates].sort((a, b) => a.x - b.x);
  let cursor = item.x;
  for (const n of sorted) {
    if (n.x !== cursor) return null; // gap (or overlap) in the tiling
    cursor += n.w;
  }
  return cursor === right ? sorted : null;
}

/** A user-saved layout: tile positions/sizes + which tiles are pinned (visible). */
export interface SavedCustomLayout {
  id: string;
  name: string;
  layout: Layout[];
  visibleWidgets: WidgetId[];
}

interface LayoutState {
  layout: Layout[];
  activePreset: string | null;
  pinnedPresets: string[];
  /** Ids (not names — names aren't unique) of saved custom layouts pinned to
   *  the titlebar quick-switch bar, alongside the pinned presets. */
  pinnedCustomLayouts: string[];
  visibleWidgets: WidgetId[];
  savedCustomLayouts: SavedCustomLayout[];
  activeCustomLayoutId: string | null; // id of the saved layout that's active, or null
  /** Pre-collapse `h` per widget, so expanding restores the prior size. Persisted
   *  with the layout so a collapsed widget survives reload with the right height. */
  savedHeights: Partial<Record<WidgetId, number>>;
  /** Update tile geometry only — never touches the active-preset markers.
   *  react-grid-layout echoes onLayoutChange on mount and after programmatic
   *  changes (applyPreset), so geometry sync must not imply a user edit. */
  syncLayout: (layout: Layout[]) => void;
  /** A real pointer gesture (drag/resize stop) — the layout is now custom. */
  markUserEdited: () => void;
  /** Collapse/expand a widget to/from its title bar, accordion-style. On collapse:
   *  stash the current `h` in savedHeights, shrink `h` to fit the title bar, and
   *  lock it (minH=maxH=h, isResizable:false) so RGL compaction can't grow it; the
   *  freed rows are GIFTED to the widgets directly below (exactNeighborsBelow) so
   *  their bottom edges — and the rest of the grid — stay put. On expand: restore
   *  `h`, drop the lock, and STEAL the rows back from those same neighbors,
   *  provided each stays ≥ its WIDGET_CONSTRAINTS minH. Whenever the row below
   *  doesn't qualify (nothing below, partial tiling, overhang, collapsed neighbor,
   *  not enough spare rows) fall back to plain shrink/restore and let
   *  compactType:'vertical' reflow the rest. Height is viewport-derived, so
   *  callers pass the live rowHeight and gap. */
  setWidgetCollapsed: (id: WidgetId, collapsed: boolean, rowHeight: number, gap: number) => void;
  applyPreset: (name: string) => void;
  resetToDefault: () => void;
  pinPreset: (name: string) => void;
  unpinPreset: (name: string) => void;
  pinCustomLayout: (id: string) => void;
  unpinCustomLayout: (id: string) => void;
  showWidget: (id: WidgetId) => void;
  hideWidget: (id: WidgetId) => void;
  /** Save current layout + pinned tiles under a name; activates it. */
  saveCustomLayout: (name: string) => void;
  /** Remove a saved layout by id. */
  deleteCustomLayout: (id: string) => void;
  /** Restore a saved layout's tile positions AND its pinned tile set. */
  applyCustomLayout: (id: string) => void;
  /** Overwrite an existing saved layout with the current layout + visibleWidgets. */
  updateCustomLayout: (id: string) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      // A fresh install IS the Default preset: its visible widgets and the layout
      // generated for exactly those (not all 21 squeezed in below it).
      layout: generateLayout(DEFAULT_LAYOUT.name, INITIAL_VISIBLE) ?? autoFillLayout(DEFAULT_LAYOUT.layout),
      activePreset: DEFAULT_LAYOUT.name,
      pinnedPresets: [],
      pinnedCustomLayouts: [],
      visibleWidgets: INITIAL_VISIBLE,
      savedCustomLayouts: [],
      activeCustomLayoutId: null,
      savedHeights: {},

      syncLayout: (layout) => set({ layout }),

      markUserEdited: () => set({ activePreset: null, activeCustomLayoutId: null }),

      setWidgetCollapsed: (id, collapsed, rowHeight, gap) =>
        set((s) => {
          const item = s.layout.find((it) => it.i === id);
          if (!item) return s;
          const constraints = WIDGET_CONSTRAINTS[id];

          if (collapsed) {
            const collapsedH = collapsedRowsFor(rowHeight, gap);
            const delta = item.h - collapsedH;
            // Accordion gift: hand the freed rows to the widgets directly below —
            // they grow upward (y -= delta, h += delta), bottoms fixed, so nothing
            // else on the grid moves and rowHeight stays constant. This is also
            // what lets the later expand take the same rows back in place.
            const giftNeighbors =
              delta > 0 ? exactNeighborsBelow(s.layout, effectiveVisible(s.visibleWidgets), item, s.savedHeights) : null;
            const giftIds = new Set((giftNeighbors ?? []).map((n) => n.i));
            const layout = s.layout.map((it) => {
              if (it.i === id)
                return { ...it, h: collapsedH, minH: collapsedH, maxH: collapsedH, isResizable: false };
              if (giftIds.has(it.i)) return { ...it, y: it.y - delta, h: it.h + delta };
              return it;
            });
            lastCollapsedRows = collapsedH;
            return {
              layout,
              // Keep an existing entry: the item may already be locked at its tiny h.
              savedHeights: { ...s.savedHeights, [id]: s.savedHeights[id] ?? item.h },
              // Collapsing is a user edit — the layout no longer matches the preset.
              activePreset: null,
              activeCustomLayoutId: null,
            };
          }

          const restoredH = s.savedHeights[id] ?? Math.max(constraints.minH, DEFAULT_EXPAND_H);
          const delta = restoredH - item.h;
          // Accordion steal: take the rows back from the widgets directly below,
          // but only if every one of them can spare `delta` rows while staying at
          // or above its own WIDGET_CONSTRAINTS minH floor (NOT the item's minH,
          // which may be stale). Otherwise fall back to the plain restore and let
          // RGL's vertical compaction push everything below down.
          const neighbors =
            delta > 0 ? exactNeighborsBelow(s.layout, effectiveVisible(s.visibleWidgets), item, s.savedHeights) : null;
          const stealNeighbors =
            neighbors &&
            neighbors.every(
              (n) => n.h - delta >= (WIDGET_CONSTRAINTS[n.i as WidgetId]?.minH ?? 1),
            )
              ? neighbors
              : null;
          const stealIds = new Set((stealNeighbors ?? []).map((n) => n.i));
          const layout = s.layout.map((it) => {
            if (it.i === id) {
              const { maxH: _drop, ...rest } = it;
              void _drop;
              return { ...rest, h: restoredH, minH: constraints.minH, isResizable: true };
            }
            if (stealIds.has(it.i)) return { ...it, y: it.y + delta, h: it.h - delta };
            return it;
          });
          const { [id]: _removed, ...remainingHeights } = s.savedHeights;
          void _removed;
          return {
            layout,
            savedHeights: remainingHeights,
            activePreset: null,
            activeCustomLayoutId: null,
          };
        }),

      applyPreset: (name) => {
        const preset = PRESETS.find((p) => p.name === name);
        if (!preset) return;
        set((s) => {
          const newVisible = effectiveVisible(preset.visibleWidgets ?? s.visibleWidgets);
          const next = normalizeCollapse(
            generateLayout(name, newVisible) ?? autoFillLayout(preset.layout),
            collapsedIdSet(),
            s.savedHeights,
          );
          return {
            layout: next.layout,
            savedHeights: next.savedHeights,
            visibleWidgets: newVisible,
            activePreset: name,
            activeCustomLayoutId: null,
          };
        });
      },

      resetToDefault: () =>
        set((s) => {
          const visible = effectiveVisible(s.visibleWidgets);
          const next = normalizeCollapse(
            generateLayout(DEFAULT_LAYOUT.name, visible) ?? autoFillLayout(DEFAULT_LAYOUT.layout),
            collapsedIdSet(),
            s.savedHeights,
          );
          return {
            layout: next.layout,
            savedHeights: next.savedHeights,
            visibleWidgets: visible,
            activePreset: DEFAULT_LAYOUT.name,
            activeCustomLayoutId: null,
          };
        }),

      pinPreset: (name) =>
        set((s) => ({
          pinnedPresets: s.pinnedPresets.includes(name)
            ? s.pinnedPresets
            : [...s.pinnedPresets, name],
        })),

      unpinPreset: (name) =>
        set((s) => ({ pinnedPresets: s.pinnedPresets.filter((p) => p !== name) })),

      pinCustomLayout: (id) =>
        set((s) => ({
          pinnedCustomLayouts: s.pinnedCustomLayouts.includes(id)
            ? s.pinnedCustomLayouts
            : [...s.pinnedCustomLayouts, id],
        })),

      unpinCustomLayout: (id) =>
        set((s) => ({ pinnedCustomLayouts: s.pinnedCustomLayouts.filter((p) => p !== id) })),

      showWidget: (id) =>
        set((s) => {
          if (s.visibleWidgets.includes(id)) return s;
          const newVisible = effectiveVisible([...s.visibleWidgets, id]);
          if (!newVisible.includes(id)) return s; // disabled in Settings
          if (s.activePreset) {
            const generated = generateLayout(s.activePreset, newVisible);
            if (generated) {
              const next = normalizeCollapse(generated, collapsedIdSet(), s.savedHeights);
              return {
                visibleWidgets: newVisible,
                layout: next.layout,
                savedHeights: next.savedHeights,
                activeCustomLayoutId: null,
              };
            }
          }
          // No active preset — ensure the widget has a grid slot (BSP generation may have
          // excluded it from layout when it was hidden, so it would never appear otherwise).
          const hasSlot = s.layout.some((item) => item.i === id);
          return {
            visibleWidgets: newVisible,
            layout: hasSlot ? s.layout : autoFillLayout(s.layout),
            activeCustomLayoutId: null,
          };
        }),

      hideWidget: (id) =>
        set((s) => {
          const newVisible = s.visibleWidgets.filter((w) => w !== id);
          if (s.activePreset) {
            const generated = generateLayout(s.activePreset, effectiveVisible(newVisible));
            if (generated) {
              const next = normalizeCollapse(generated, collapsedIdSet(), s.savedHeights);
              return {
                visibleWidgets: newVisible,
                layout: next.layout,
                savedHeights: next.savedHeights,
                activeCustomLayoutId: null,
              };
            }
          }
          return { visibleWidgets: newVisible, activeCustomLayoutId: null };
        }),

      saveCustomLayout: (name) =>
        set((s) => {
          const id = crypto.randomUUID();
          return {
            savedCustomLayouts: [
              ...s.savedCustomLayouts,
              {
                id,
                name,
                // Snapshot deep copies so later edits don't mutate the saved entry.
                layout: unlockedSnapshot(s.layout, s.savedHeights),
                visibleWidgets: [...s.visibleWidgets],
              },
            ],
            activeCustomLayoutId: id,
            activePreset: null,
          };
        }),

      deleteCustomLayout: (id) =>
        set((s) => ({
          savedCustomLayouts: s.savedCustomLayouts.filter((l) => l.id !== id),
          activeCustomLayoutId: s.activeCustomLayoutId === id ? null : s.activeCustomLayoutId,
          // A deleted layout must not leave a ghost chip in the titlebar bar.
          pinnedCustomLayouts: s.pinnedCustomLayouts.filter((p) => p !== id),
        })),

      updateCustomLayout: (id) =>
        set((s) => ({
          savedCustomLayouts: s.savedCustomLayouts.map((l) =>
            l.id === id
              ? { ...l, layout: unlockedSnapshot(s.layout, s.savedHeights), visibleWidgets: [...s.visibleWidgets] }
              : l,
          ),
          activeCustomLayoutId: id,
        })),

      applyCustomLayout: (id) =>
        set((s) => {
          const found = s.savedCustomLayouts.find((l) => l.id === id);
          if (!found) return s;
          const next = normalizeCollapse(
            autoFillLayout(found.layout.map((item) => ({ ...item }))),
            collapsedIdSet(),
            s.savedHeights,
          );
          return {
            layout: next.layout,
            savedHeights: next.savedHeights,
            visibleWidgets: effectiveVisible(found.visibleWidgets),
            activePreset: null,
            activeCustomLayoutId: id,
          };
        }),
    }),
    {
      name: 'dashboard-layout',
      // Bump with a real migrate when the persisted shape changes.
      version: 1,
      migrate: (persisted) => persisted as LayoutState,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Persisted data can hold ids this build does not know (removed or renamed
        // widget, backup from a newer build) or a wrong shape: DashboardGrid would
        // throw on WIDGET_REGISTRY[id]. Coerce and filter everything first.
        const defaultVisible: WidgetId[] = [...(DEFAULT_LAYOUT.visibleWidgets ?? ALL_WIDGET_IDS)];
        const ids = (v: unknown): WidgetId[] => (Array.isArray(v) ? v.filter(isWidgetId) : []);
        const items = (v: unknown): Layout[] =>
          Array.isArray(v) ? v.filter((it) => it && typeof it === 'object' && isWidgetId((it as Layout).i)) : [];

        const rawHeights = state.savedHeights && typeof state.savedHeights === 'object' ? state.savedHeights : {};
        const savedHeights: Partial<Record<WidgetId, number>> = {};
        for (const [k, v] of Object.entries(rawHeights)) {
          if (isWidgetId(k) && typeof v === 'number') savedHeights[k] = v;
        }

        // Back-fill only a MISSING field (stores that predate it); an empty array is
        // a real choice (the user unpinned everything).
        state.visibleWidgets =
          state.visibleWidgets === undefined ? [...ALL_WIDGET_IDS] : ids(state.visibleWidgets);

        const rawLayout = Array.isArray(state.layout)
          ? items(state.layout)
          : (generateLayout(DEFAULT_LAYOUT.name, defaultVisible) ?? DEFAULT_LAYOUT.layout);
        // Re-clamp mins to current WIDGET_CONSTRAINTS so layouts saved with older
        // (larger) minH/minW pick up the new, smaller floors instead of staying stuck.
        const clamped = applyConstraints(autoFillLayout(rawLayout));
        // applyConstraints resets minH, which would UNLOCK a persisted collapsed
        // item; re-lock every id the widget-UI store says is collapsed. The exact
        // collapsed h gets re-derived from the live rowHeight by DashboardGrid.
        const normalized = normalizeCollapse(clamped, collapsedIdSet(), savedHeights, true);
        state.layout = normalized.layout;
        state.savedHeights = normalized.savedHeights;

        // Back-fill custom-layout fields for stored states that predate them, and
        // re-clamp each saved layout's mins too.
        state.savedCustomLayouts = (Array.isArray(state.savedCustomLayouts) ? state.savedCustomLayouts : [])
          .filter((l) => l && typeof l === 'object' && typeof l.id === 'string')
          .map((l) => ({
            ...l,
            layout: applyConstraints(items(l.layout)),
            visibleWidgets: ids(l.visibleWidgets),
          }));
        if (state.activeCustomLayoutId === undefined) state.activeCustomLayoutId = null;
        // Prune pinned ids whose layout no longer exists (defensive).
        const savedIds = new Set(state.savedCustomLayouts.map((l) => l.id));
        state.pinnedCustomLayouts = (Array.isArray(state.pinnedCustomLayouts) ? state.pinnedCustomLayouts : []).filter(
          (id) => savedIds.has(id),
        );
      },
    }
  )
);
