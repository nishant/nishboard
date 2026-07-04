import { create } from 'zustand';

export type HardwareViewMode = 'sparks' | 'bars';

// Non-persisted UI state shared between the HardwareWidget body and its
// WidgetShell header actions (view toggle + config gear live in the shell row).
interface HardwareUiState {
  view: HardwareViewMode;
  configOpen: boolean;
  setView: (v: HardwareViewMode) => void;
  toggleConfig: () => void;
}

export const useHardwareUiStore = create<HardwareUiState>((set) => ({
  view: 'sparks',
  configOpen: false,
  setView: (view) => set({ view }),
  toggleConfig: () => set((s) => ({ configOpen: !s.configOpen })),
}));
