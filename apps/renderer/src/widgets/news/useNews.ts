import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { NewsData } from '@dash/shared';

export function useNews() {
  const interval = useGatedInterval(10 * 60 * 1000);
  return useQuery<NewsData>({
    queryKey: ['news'],
    queryFn: () => apiClient.get<NewsData>('/api/news'),
    refetchInterval: interval,
    staleTime: 10 * 60 * 1000,
  });
}
