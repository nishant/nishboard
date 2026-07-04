import { create } from 'zustand';

/** Ephemeral weather-widget UI state — lets the WidgetShell header action
 *  (radar toggle) drive the widget body. Not persisted: the radar iframe is
 *  deliberately lazy and shouldn't auto-load on app start. */
interface WeatherUiState {
  radarOpen: boolean;
  toggleRadar: () => void;
}

export const useWeatherUiStore = create<WeatherUiState>()((set) => ({
  radarOpen: false,
  toggleRadar: () => set((s) => ({ radarOpen: !s.radarOpen })),
}));
