import { create } from 'zustand';

// Non-persisted — pause state shared between the WidgetShell header action and
// the widget body (which gates the main-process poller with it).
interface ClipboardUiState {
  paused: boolean;
  togglePaused: () => void;
}

export const useClipboardUiStore = create<ClipboardUiState>((set) => ({
  paused: false,
  togglePaused: () => set((s) => ({ paused: !s.paused })),
}));
