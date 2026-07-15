import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { WIDGET_CATEGORIES } from '../lib/layouts';
import type { WidgetCategory, WidgetId } from '../lib/layouts';

/** Display order for a category's widgets: the user's persisted order first
 *  (pruned of ids no longer in the category — defensive against stale
 *  persisted data), then any category widgets missing from it appended in
 *  default order (new widgets after app updates land at the bottom). */
export function orderedCategoryWidgets(
  category: WidgetCategory,
  menuOrder: Partial<Record<string, WidgetId[]>>,
): WidgetId[] {
  const stored = menuOrder[category.id];
  if (!stored) return [...category.widgets];
  const inCategory = new Set(category.widgets);
  const kept = stored.filter((id) => inCategory.has(id));
  const seen = new Set(kept);
  return [...kept, ...category.widgets.filter((id) => !seen.has(id))];
}

// Per-widget accordion collapse state. `collapsed[id] === true` means the widget
// is showing only its title bar (WidgetShell drops the body). This boolean is the
// persisted source of truth for the collapsed flag; the matching grid-item height
// lock lives in layoutStore (savedHeights + minH/maxH). DashboardGrid keeps the two
// in sync on toggle and re-derives collapsed heights on rehydrate/resize.
interface WidgetUiState {
  collapsed: Partial<Record<WidgetId, boolean>>;
  /** User-chosen row order per category id for the Widgets menu / layout
   *  editor. Absent key = the category's default order. Merged with defaults
   *  by orderedCategoryWidgets. */
  menuOrder: Partial<Record<string, WidgetId[]>>;
  toggleCollapsed: (id: WidgetId) => void;
  setCollapsed: (id: WidgetId, collapsed: boolean) => void;
  /** Move a widget one row up (-1) or down (+1) within its category's display
   *  order. No-ops at the boundaries or for unknown category/widget ids. */
  moveWidget: (categoryId: string, id: WidgetId, direction: -1 | 1) => void;
}

export const useWidgetUiStore = create<WidgetUiState>()(
  persist(
    (set) => ({
      collapsed: {},
      menuOrder: {},
      toggleCollapsed: (id) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
      setCollapsed: (id, collapsed) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: collapsed } })),
      moveWidget: (categoryId, id, direction) =>
        set((s) => {
          const category = WIDGET_CATEGORIES.find((c) => c.id === categoryId);
          if (!category) return s;
          const order = orderedCategoryWidgets(category, s.menuOrder);
          const idx = order.indexOf(id);
          const target = idx + direction;
          if (idx === -1 || target < 0 || target >= order.length) return s;
          const next = [...order];
          [next[idx], next[target]] = [next[target], next[idx]];
          return { menuOrder: { ...s.menuOrder, [categoryId]: next } };
        }),
    }),
    {
      name: 'dashboard-widget-ui',
      partialize: (s) => ({ collapsed: s.collapsed, menuOrder: s.menuOrder }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Back-fill for stored states that predate menuOrder, and prune stale
        // entries: unknown category keys are dropped, ids that moved out of a
        // category are removed (same spirit as layoutStore's
        // pinnedCustomLayouts pruning).
        if (!state.menuOrder) {
          state.menuOrder = {};
          return;
        }
        const validIds = new Map(WIDGET_CATEGORIES.map((c) => [c.id, new Set(c.widgets)]));
        const pruned: Partial<Record<string, WidgetId[]>> = {};
        for (const [categoryId, ids] of Object.entries(state.menuOrder)) {
          const valid = validIds.get(categoryId);
          if (!valid || !ids) continue;
          pruned[categoryId] = ids.filter((id) => valid.has(id));
        }
        state.menuOrder = pruned;
      },
    },
  ),
);
