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
  /** Collapse/expand a widget to its title bar. On collapse: stash the current `h`
   *  in savedHeights, shrink `h` to fit the title bar, and lock it (minH=maxH=h,
   *  isResizable:false) so RGL compaction can't grow it. On expand: restore `h`,
   *  drop the lock. Height is viewport-derived, so callers pass the live rowHeight
   *  and gap. compactType:'vertical' reflows the rest automatically. */
  setWidgetCollapsed: (id: WidgetId, collapsed: boolean, rowHeight: number, gap: number) => void;
  applyPreset: (name: string) => void;
  resetToDefault: () => void;
  pinPreset: (name: string) => void;
  unpinPreset: (name: string) => void;
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
            const layout = s.layout.map((it) =>
              it.i === id
                ? { ...it, h: collapsedH, minH: collapsedH, maxH: collapsedH, isResizable: false }
                : it,
            );
            return {
              layout,
              savedHeights: { ...s.savedHeights, [id]: item.h },
              // Collapsing is a user edit — the layout no longer matches the preset.
              activePreset: null,
              activeCustomLayoutId: null,
            };
          }

          const restoredH = s.savedHeights[id] ?? constraints.minH ?? DEFAULT_EXPAND_H;
          const layout = s.layout.map((it) => {
            if (it.i !== id) return it;
            const { maxH: _drop, ...rest } = it;
            void _drop;
            return { ...rest, h: restoredH, minH: constraints.minH, isResizable: true };
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
        }
      },
    }
  )
);
