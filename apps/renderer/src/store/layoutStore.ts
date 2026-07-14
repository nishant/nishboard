import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layout } from 'react-grid-layout';
import { DEFAULT_LAYOUT, PRESETS, autoFillLayout, applyConstraints, generateLayout, ALL_WIDGET_IDS, WIDGET_CONSTRAINTS } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';

/** WidgetShell header height in px: px-3 py-2 (16px vertical) + ~13px text + 1px
 *  border ≈ 34. Used to compute how few grid rows a collapsed (title-bar-only)
 *  widget needs. */
export const TITLEBAR_PX = 34;

/** Default grid-row height to restore a collapsed widget to when no prior height
 *  was captured (defensive — savedHeights should normally hold the real value). */
const DEFAULT_EXPAND_H = 6;

/** How many grid rows a collapsed widget needs to show just its title bar, given
 *  the current viewport-derived rowHeight and inter-item gap. rowHeight is small
 *  (many rows) → needs a couple rows; rowHeight large (few rows) → a single row.
 *  Exported for tests. */
export function collapsedRowsFor(rowHeight: number, gap: number): number {
  return Math.max(1, Math.ceil((TITLEBAR_PX + gap) / (rowHeight + gap)));
}

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
      layout: autoFillLayout(DEFAULT_LAYOUT.layout),
      activePreset: DEFAULT_LAYOUT.name,
      pinnedPresets: [],
      pinnedCustomLayouts: [],
      visibleWidgets: [...ALL_WIDGET_IDS],
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
              delta > 0 ? exactNeighborsBelow(s.layout, s.visibleWidgets, item, s.savedHeights) : null;
            const giftIds = new Set((giftNeighbors ?? []).map((n) => n.i));
            const layout = s.layout.map((it) => {
              if (it.i === id)
                return { ...it, h: collapsedH, minH: collapsedH, maxH: collapsedH, isResizable: false };
              if (giftIds.has(it.i)) return { ...it, y: it.y - delta, h: it.h + delta };
              return it;
            });
            return {
              layout,
              savedHeights: { ...s.savedHeights, [id]: item.h },
              // Collapsing is a user edit — the layout no longer matches the preset.
              activePreset: null,
              activeCustomLayoutId: null,
            };
          }

          const restoredH = s.savedHeights[id] ?? constraints.minH ?? DEFAULT_EXPAND_H;
          const delta = restoredH - item.h;
          // Accordion steal: take the rows back from the widgets directly below,
          // but only if every one of them can spare `delta` rows while staying at
          // or above its own WIDGET_CONSTRAINTS minH floor (NOT the item's minH,
          // which may be stale). Otherwise fall back to the plain restore and let
          // RGL's vertical compaction push everything below down.
          const neighbors =
            delta > 0 ? exactNeighborsBelow(s.layout, s.visibleWidgets, item, s.savedHeights) : null;
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
          const newVisible = preset.visibleWidgets ?? s.visibleWidgets;
          return {
            layout: generateLayout(name, newVisible) ?? autoFillLayout(preset.layout),
            visibleWidgets: newVisible,
            activePreset: name,
            activeCustomLayoutId: null,
          };
        });
      },

      resetToDefault: () =>
        set((s) => ({
          layout:
            generateLayout(DEFAULT_LAYOUT.name, s.visibleWidgets) ??
            autoFillLayout(DEFAULT_LAYOUT.layout),
          activePreset: DEFAULT_LAYOUT.name,
          activeCustomLayoutId: null,
        })),

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
          const newVisible = [...s.visibleWidgets, id];
          if (s.activePreset) {
            const generated = generateLayout(s.activePreset, newVisible);
            if (generated)
              return { visibleWidgets: newVisible, layout: generated, activeCustomLayoutId: null };
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
            const generated = generateLayout(s.activePreset, newVisible);
            if (generated)
              return { visibleWidgets: newVisible, layout: generated, activeCustomLayoutId: null };
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
                layout: s.layout.map((item) => ({ ...item })),
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
              ? { ...l, layout: s.layout.map((item) => ({ ...item })), visibleWidgets: [...s.visibleWidgets] }
              : l,
          ),
          activeCustomLayoutId: id,
        })),

      applyCustomLayout: (id) =>
        set((s) => {
          const found = s.savedCustomLayouts.find((l) => l.id === id);
          if (!found) return s;
          return {
            layout: autoFillLayout(found.layout.map((item) => ({ ...item }))),
            visibleWidgets: [...found.visibleWidgets],
            activePreset: null,
            activeCustomLayoutId: id,
          };
        }),
    }),
    {
      name: 'dashboard-layout',
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (!state.savedHeights) state.savedHeights = {};
          // Re-clamp mins to current WIDGET_CONSTRAINTS so layouts saved with older
          // (larger) minH/minW pick up the new, smaller floors instead of staying stuck.
          state.layout = applyConstraints(autoFillLayout(state.layout));
          // applyConstraints resets minH to the widget's floor, which would UNLOCK a
          // persisted collapsed item (its minH was pinned to its tiny collapsed h).
          // Re-lock every item still recorded in savedHeights so collapsed widgets
          // survive reload collapsed. The exact collapsed h gets re-derived from the
          // live viewport rowHeight by DashboardGrid once it mounts.
          state.layout = state.layout.map((item) => {
            const id = item.i as WidgetId;
            if (state.savedHeights[id] === undefined) return item;
            return { ...item, minH: item.h, maxH: item.h, isResizable: false };
          });
          // Back-fill visibleWidgets for stored states that predate this field
          if (!state.visibleWidgets || state.visibleWidgets.length === 0) {
            state.visibleWidgets = [...ALL_WIDGET_IDS];
          }
          // Back-fill custom-layout fields for stored states that predate them, and
          // re-clamp each saved layout's mins too.
          if (!state.savedCustomLayouts) state.savedCustomLayouts = [];
          else state.savedCustomLayouts = state.savedCustomLayouts.map((l) => ({
            ...l,
            layout: applyConstraints(l.layout),
          }));
          if (state.activeCustomLayoutId === undefined) state.activeCustomLayoutId = null;
          // Back-fill for stored states that predate pinned custom layouts, and
          // prune ids whose layout no longer exists (defensive).
          if (!state.pinnedCustomLayouts) state.pinnedCustomLayouts = [];
          else {
            const ids = new Set(state.savedCustomLayouts.map((l) => l.id));
            state.pinnedCustomLayouts = state.pinnedCustomLayouts.filter((id) => ids.has(id));
          }
        }
      },
    }
  )
);
