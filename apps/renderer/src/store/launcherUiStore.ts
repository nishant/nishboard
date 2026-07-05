import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Launcher items/groups themselves live main-side in userData/launcher.json.
// `editing` (WidgetShell pencil → widget-body modal) is ephemeral; `collapsed`
// is a layout preference and persists — partialize keeps `editing` out.
interface LauncherUiState {
  editing: boolean;
  /** Collapsed group ids (true = collapsed). */
  collapsed: Record<string, boolean>;
  setEditing: (editing: boolean) => void;
  toggleCollapsed: (groupId: string) => void;
}

export const useLauncherUiStore = create<LauncherUiState>()(
  persist(
    (set) => ({
      editing: false,
      collapsed: {},
      setEditing: (editing) => set({ editing }),
      toggleCollapsed: (groupId) =>
        set((s) => ({ collapsed: { ...s.collapsed, [groupId]: !s.collapsed[groupId] } })),
    }),
    {
      name: 'dashboard-launcher-ui',
      partialize: (s) => ({ collapsed: s.collapsed }),
    },
  ),
);
