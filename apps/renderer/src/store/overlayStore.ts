import { create } from 'zustand';

// Non-persisted overlay state. Lifted out of component state so the command
// palette can open Settings, and so the palette itself can be toggled from
// anywhere (keyboard handler, actions).
interface OverlayState {
  settingsOpen: boolean;
  paletteOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  settingsOpen: false,
  paletteOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
