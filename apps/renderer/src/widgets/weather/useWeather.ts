import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useAppSettingsStore } from '../../store/settingsStore';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { WeatherData } from '@dash/shared';

/** The ZIP currently selected by the widget's location cycler ('' = auto by IP). */
export function useActiveWeatherZip(): string {
  const zips = useAppSettingsStore((s) => s.weatherZips);
  const idx = useAppSettingsStore((s) => s.weatherZipIdx);
  if (zips.length === 0) return '';
  return (zips[Math.min(idx, zips.length - 1)] ?? '').trim();
}

export function useWeather(enabled = true) {
  const zip = useActiveWeatherZip();
  const tempUnit = useAppSettingsStore((s) => s.tempUnit);
  const windUnit = useAppSettingsStore((s) => s.windUnit);
  const interval = useGatedInterval(15 * 60 * 1000);
  return useQuery<WeatherData>({
    // Key includes ZIP + units so changing either in Settings refetches the right data
    // (the server caches per zip:temp:wind combination too).
    queryKey: ['weather', zip, tempUnit, windUnit],
    queryFn: () => {
      const params = new URLSearchParams({ temp: tempUnit, wind: windUnit });
      if (zip) params.set('zip', zip);
      return apiClient.get<WeatherData>(`/api/weather?${params}`);
    },
    enabled,
    refetchInterval: interval,
    staleTime: 15 * 60 * 1000,
  });
}
