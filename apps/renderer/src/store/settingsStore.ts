import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Density = 'compact' | 'comfortable';
export type TempUnit = 'f' | 'c';
export type WindUnit = 'mph' | 'kmh';

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
  /** Renderer zoom factor (Electron `webFrame.setZoomFactor`). 1 = 100%. */
  uiScale: number;
  /** Spacing density of the widget grid (gap between tiles). */
  density: Density;
  /** Force the compact (icon-only + pinned-layouts submenu) titlebar at any width.
   *  When false, the titlebar auto-compacts only on narrow windows. */
  compactTitlebar: boolean;
  /** Temperature unit for the weather widget (server converts via Open-Meteo). */
  tempUnit: TempUnit;
  /** Wind-speed unit for the weather widget. */
  windUnit: WindUnit;
  /** 24-hour clock everywhere times are displayed (titlebar, world clock, alarms, …). */
  clock24h: boolean;

  setWeatherZip: (zip: string) => void;
  setShowTempInClock: (show: boolean) => void;
  setUiScale: (scale: number) => void;
  setDensity: (density: Density) => void;
  setCompactTitlebar: (compact: boolean) => void;
  setTempUnit: (unit: TempUnit) => void;
  setWindUnit: (unit: WindUnit) => void;
  setClock24h: (on: boolean) => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      weatherZip: '',
      showTempInClock: false,
      uiScale: 1,
      density: 'comfortable',
      compactTitlebar: false,
      tempUnit: 'f',
      windUnit: 'mph',
      clock24h: false,

      setWeatherZip: (weatherZip) => set({ weatherZip }),
      setShowTempInClock: (showTempInClock) => set({ showTempInClock }),
      setUiScale: (uiScale) => set({ uiScale }),
      setDensity: (density) => set({ density }),
      setCompactTitlebar: (compactTitlebar) => set({ compactTitlebar }),
      setTempUnit: (tempUnit) => set({ tempUnit }),
      setWindUnit: (windUnit) => set({ windUnit }),
      setClock24h: (clock24h) => set({ clock24h }),
    }),
    { name: 'dashboard-app-settings' },
  ),
);
