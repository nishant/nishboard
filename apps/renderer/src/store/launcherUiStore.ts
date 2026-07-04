import { create } from 'zustand';

// Non-persisted — lets the WidgetShell header pencil open the widget-body modal.
// (Launcher items themselves live main-side in userData/launcher.json.)
interface LauncherUiState {
  editing: boolean;
  setEditing: (editing: boolean) => void;
}

export const useLauncherUiStore = create<LauncherUiState>((set) => ({
  editing: false,
  setEditing: (editing) => set({ editing }),
}));
