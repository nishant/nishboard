import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WidgetId } from '../lib/layouts';

// Per-widget accordion collapse state. `collapsed[id] === true` means the widget
// is showing only its title bar (WidgetShell drops the body). This boolean is the
// persisted source of truth for the collapsed flag; the matching grid-item height
// lock lives in layoutStore (savedHeights + minH/maxH). DashboardGrid keeps the two
// in sync on toggle and re-derives collapsed heights on rehydrate/resize.
interface WidgetUiState {
  collapsed: Partial<Record<WidgetId, boolean>>;
  toggleCollapsed: (id: WidgetId) => void;
  setCollapsed: (id: WidgetId, collapsed: boolean) => void;
}

export const useWidgetUiStore = create<WidgetUiState>()(
  persist(
    (set) => ({
      collapsed: {},
      toggleCollapsed: (id) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
      setCollapsed: (id, collapsed) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: collapsed } })),
    }),
    {
      name: 'dashboard-widget-ui',
      partialize: (s) => ({ collapsed: s.collapsed }),
    },
  ),
);
