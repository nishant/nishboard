import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * App-level user preferences (non-secret, renderer-only).
 * Distinct from API credentials (safeStorage, main process) and from
 * layout/theme stores. Persisted to localStorage under `dashboard-app-settings`.
 */
interface AppSettingsState {
  /** 5-digit US ZIP to override weather location. '' = auto-detect by IP. */
  weatherZip: string;
  /** Show the current temperature next to the centered titlebar clock. */
  showTempInClock: boolean;

  setWeatherZip: (zip: string) => void;
  setShowTempInClock: (show: boolean) => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      weatherZip: '',
      showTempInClock: false,

      setWeatherZip: (weatherZip) => set({ weatherZip }),
      setShowTempInClock: (showTempInClock) => set({ showTempInClock }),
    }),
    { name: 'dashboard-app-settings' },
  ),
);
