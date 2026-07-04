import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { TwitchSearchPage, TwitchAuthStatus } from '@dash/shared';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';

/** Poll auth state so the widget flips to Following automatically after the
 *  browser OAuth round-trip completes against the server. */
export function useTwitchAuthStatus() {
  const interval = useGatedInterval(15_000);
  return useQuery<TwitchAuthStatus>({
    queryKey: ['twitch-auth'],
    queryFn: () => apiClient.get<TwitchAuthStatus>('/api/twitch/auth-status'),
    refetchInterval: interval,
    staleTime: 10_000,
  });
}

export function useTwitchConnect() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiClient.get<{ url: string }>('/api/twitch/auth-url');
      // Guarded in the main process to https://id.twitch.tv/ only.
      window.electron?.openTwitchAuth?.(url);
    },
  });
}

export function useTwitchLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/twitch/logout'),
    onSuccess: () => {
      qc.setQueryData<TwitchAuthStatus>(['twitch-auth'], { authenticated: false });
      void qc.invalidateQueries({ queryKey: ['twitch-followed'] });
    },
  });
}

export function useTwitchFollowed(enabled: boolean) {
  const interval = useGatedInterval(60_000);
  return useQuery<TwitchSearchPage>({
    queryKey: ['twitch-followed'],
    queryFn: () => apiClient.get<TwitchSearchPage>('/api/twitch/followed'),
    enabled,
    refetchInterval: enabled ? interval : false,
    staleTime: 55_000,
    retry: 1,
  });
}

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
