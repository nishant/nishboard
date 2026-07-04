import { create } from 'zustand';

export type HardwareViewMode = 'sparks' | 'bars';
export type ProcessSort = 'cpu' | 'ram';

// Non-persisted UI state shared between the HardwareWidget body and its
// WidgetShell header actions (view toggle + config gear live in the shell row).
// processesOpen is deliberately not persisted: si.processes() is expensive on
// Windows, so the panel — and its polling — should never auto-open on launch.
interface HardwareUiState {
  view: HardwareViewMode;
  configOpen: boolean;
  processesOpen: boolean;
  procSort: ProcessSort;
  setView: (v: HardwareViewMode) => void;
  toggleConfig: () => void;
  toggleProcesses: () => void;
  setProcSort: (s: ProcessSort) => void;
}

export const useHardwareUiStore = create<HardwareUiState>((set) => ({
  view: 'sparks',
  configOpen: false,
  processesOpen: false,
  procSort: 'cpu',
  setView: (view) => set({ view }),
  toggleConfig: () => set((s) => ({ configOpen: !s.configOpen })),
  toggleProcesses: () => set((s) => ({ processesOpen: !s.processesOpen })),
  setProcSort: (procSort) => set({ procSort }),
}));
