import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import type { NewsData } from '@dash/shared';

export function useNews() {
  return useQuery<NewsData>({
    queryKey: ['news'],
    queryFn: () => apiClient.get<NewsData>('/api/news'),
    refetchInterval: 10 * 60 * 1000,
    staleTime: 10 * 60 * 1000,
  });
}
