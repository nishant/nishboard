import { useQuery } from '@tanstack/react-query';
import type { YoutubeSearchPage } from '@dash/shared';
import { apiClient } from '../../lib/apiClient';

export function useYoutubeSearch(query: string, pageToken?: string) {
  return useQuery<YoutubeSearchPage>({
    queryKey: ['youtube-search', query, pageToken],
    queryFn: () => {
      const params = new URLSearchParams({ q: query });
      if (pageToken) params.set('pageToken', pageToken);
      return apiClient.get<YoutubeSearchPage>(`/api/youtube/search?${params.toString()}`);
    },
    enabled: query.length > 0,
    staleTime: 5 * 60 * 1000, // cache results 5 min
  });
}
