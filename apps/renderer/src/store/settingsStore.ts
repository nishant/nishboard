import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Density = 'compact' | 'comfortable';
export type TempUnit = 'f' | 'c';
export type WindUnit = 'mph' | 'kmh';
export type LowPowerMode = 'off' | 'on' | 'auto';
export type WeatherAlertNotify = 'off' | 'severe' | 'all';

/**
 * App-level user preferences (non-secret, renderer-only).
 * Distinct from API credentials (safeStorage, main process) and from
 * layout/theme stores. Persisted to localStorage under `dashboard-app-settings`.
 */
interface AppSettingsState {
  /** 5-digit US ZIPs for weather locations, cycled with ‹ › in the widget.
   *  Empty list = auto-detect by IP. */
  weatherZips: string[];
  /** Index of the currently shown weather location (clamped by consumers). */
  weatherZipIdx: number;
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
  /** Slow all widget polling ×4: 'on' always, 'auto' only while on battery.
   *  (Polling always pauses while the window is hidden, regardless of this.) */
  lowPower: LowPowerMode;
  /** Push NEW NWS alerts as chime+toast+native notification: Extreme/Severe
   *  only, everything, or off. */
  weatherAlertNotify: WeatherAlertNotify;

  setWeatherZips: (zips: string[]) => void;
  setWeatherZipIdx: (idx: number) => void;
  setShowTempInClock: (show: boolean) => void;
  setUiScale: (scale: number) => void;
  setDensity: (density: Density) => void;
  setCompactTitlebar: (compact: boolean) => void;
  setTempUnit: (unit: TempUnit) => void;
  setWindUnit: (unit: WindUnit) => void;
  setClock24h: (on: boolean) => void;
  setLowPower: (mode: LowPowerMode) => void;
  setWeatherAlertNotify: (mode: WeatherAlertNotify) => void;
}

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      weatherZips: [],
      weatherZipIdx: 0,
      showTempInClock: false,
      uiScale: 1,
      density: 'comfortable',
      compactTitlebar: false,
      tempUnit: 'f',
      windUnit: 'mph',
      clock24h: false,
      lowPower: 'off',
      // New keys shallow-merge into persisted state — no version bump needed.
      weatherAlertNotify: 'severe',

      // Reset the cycle index too — it may point past the end of the new list.
      setWeatherZips: (weatherZips) => set({ weatherZips, weatherZipIdx: 0 }),
      setWeatherZipIdx: (weatherZipIdx) => set({ weatherZipIdx }),
      setShowTempInClock: (showTempInClock) => set({ showTempInClock }),
      setUiScale: (uiScale) => set({ uiScale }),
      setDensity: (density) => set({ density }),
      setCompactTitlebar: (compactTitlebar) => set({ compactTitlebar }),
      setTempUnit: (tempUnit) => set({ tempUnit }),
      setWindUnit: (windUnit) => set({ windUnit }),
      setClock24h: (clock24h) => set({ clock24h }),
      setLowPower: (lowPower) => set({ lowPower }),
      setWeatherAlertNotify: (weatherAlertNotify) => set({ weatherAlertNotify }),
    }),
    {
      name: 'dashboard-app-settings',
      version: 1,
      // v0 stored a single `weatherZip: string`; v1 is `weatherZips: string[]`.
      migrate: (persisted) => {
        const state = persisted as Partial<AppSettingsState> & { weatherZip?: string };
        if (typeof state.weatherZip === 'string') {
          state.weatherZips = state.weatherZip ? [state.weatherZip] : [];
          delete state.weatherZip;
        }
        return state;
      },
    },
  ),
);
