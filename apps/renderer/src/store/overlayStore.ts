import { create } from 'zustand';

// Non-persisted overlay state. Lifted out of component state so the command
// palette can open Settings, and so the palette itself can be toggled from
// anywhere (keyboard handler, actions).
export type SettingsTab = 'app' | 'alerts' | 'dev';

interface OverlayState {
  settingsOpen: boolean;
  /** Tab the modal starts on — read once at mount by SettingsModal. */
  settingsTab: SettingsTab;
  paletteOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Open Settings on a specific tab (palette actions use this). */
  openSettings: (tab?: SettingsTab) => void;
  setPaletteOpen: (open: boolean) => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  settingsOpen: false,
  settingsTab: 'app',
  paletteOpen: false,
  // Plain open (titlebar gear) resets to the default tab.
  setSettingsOpen: (settingsOpen) => set(settingsOpen ? { settingsOpen, settingsTab: 'app' } : { settingsOpen }),
  openSettings: (tab = 'app') => set({ settingsOpen: true, settingsTab: tab }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
