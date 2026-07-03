import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Layout } from 'react-grid-layout';
import { DEFAULT_LAYOUT, PRESETS, autoFillLayout, applyConstraints, generateLayout, ALL_WIDGET_IDS } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';

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
  /** Update tile geometry only — never touches the active-preset markers.
   *  react-grid-layout echoes onLayoutChange on mount and after programmatic
   *  changes (applyPreset), so geometry sync must not imply a user edit. */
  syncLayout: (layout: Layout[]) => void;
  /** A real pointer gesture (drag/resize stop) — the layout is now custom. */
  markUserEdited: () => void;
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

      syncLayout: (layout) => set({ layout }),

      markUserEdited: () => set({ activePreset: null, activeCustomLayoutId: null }),

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
          // Re-clamp mins to current WIDGET_CONSTRAINTS so layouts saved with older
          // (larger) minH/minW pick up the new, smaller floors instead of staying stuck.
          state.layout = applyConstraints(autoFillLayout(state.layout));
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
