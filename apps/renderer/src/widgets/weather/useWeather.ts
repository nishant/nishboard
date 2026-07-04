import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useAppSettingsStore } from '../../store/settingsStore';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { WeatherData } from '@dash/shared';

export function useWeather(enabled = true) {
  const zip = useAppSettingsStore((s) => s.weatherZip).trim();
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
