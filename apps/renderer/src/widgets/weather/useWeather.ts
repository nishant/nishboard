import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useAppSettingsStore } from '../../store/settingsStore';
import type { WeatherData } from '@dash/shared';

export function useWeather(enabled = true) {
  const zip = useAppSettingsStore((s) => s.weatherZip).trim();
  return useQuery<WeatherData>({
    // Key includes the ZIP so changing it in Settings refetches the right location.
    queryKey: ['weather', zip],
    queryFn: () =>
      apiClient.get<WeatherData>(`/api/weather${zip ? `?zip=${encodeURIComponent(zip)}` : ''}`),
    enabled,
    refetchInterval: 15 * 60 * 1000,
    staleTime: 15 * 60 * 1000,
  });
}
