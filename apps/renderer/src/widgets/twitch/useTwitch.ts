import { useQuery } from '@tanstack/react-query';
import type { TwitchSearchPage } from '@dash/shared';
import { apiClient } from '../../lib/apiClient';

export function useTwitchSearch(query: string, after?: string) {
  return useQuery<TwitchSearchPage>({
    queryKey: ['twitch-search', query, after],
    queryFn: () => {
      const params = new URLSearchParams({ q: query });
      if (after) params.set('after', after);
      return apiClient.get<TwitchSearchPage>(`/api/twitch/search?${params.toString()}`);
    },
    enabled: query.length > 0,
    staleTime: 60 * 1000, // streams go on/offline — shorter cache than YouTube
  });
}
