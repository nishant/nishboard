import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  TwitchSearchPage, TwitchAuthStatus, TwitchCategory, TwitchVideosPage, TwitchVideoType,
} from '@dash/shared';
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
      void qc.invalidateQueries({ queryKey: ['twitch-followed-all'] });
    },
  });
}

export const TWITCH_FOLLOWED_POLL_MS = 60_000;

/** `intervalOverride` replaces the visibility-gated poll (the live notifier keeps
 *  polling while the window is hidden). */
export function useTwitchFollowed(enabled: boolean, intervalOverride?: number | false) {
  const gated = useGatedInterval(TWITCH_FOLLOWED_POLL_MS);
  const interval = intervalOverride ?? gated;
  return useQuery<TwitchSearchPage>({
    queryKey: ['twitch-followed'],
    queryFn: () => apiClient.get<TwitchSearchPage>('/api/twitch/followed'),
    enabled,
    refetchInterval: enabled ? interval : false,
    refetchIntervalInBackground: intervalOverride !== undefined,
    staleTime: 55_000,
    retry: 1,
  });
}

/** Every followed channel (live first, then alphabetical offline). Same 60s
 *  poll as the live list — the server refreshes live flags at that cadence
 *  while the follow/avatar set is cached for 5 min upstream. */
export function useTwitchFollowedAll(enabled: boolean) {
  const interval = useGatedInterval(60_000);
  return useQuery<TwitchSearchPage>({
    queryKey: ['twitch-followed-all'],
    queryFn: () => apiClient.get<TwitchSearchPage>('/api/twitch/followed-all'),
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

// ── Browse: games and a channel's videos (app token, no sign-in) ─────────────

/** Top games right now (Games tab). Server caches 10 min. */
export function useTwitchTopGames(enabled: boolean) {
  return useQuery<TwitchCategory[]>({
    queryKey: ['twitch-top-games'],
    queryFn: () => apiClient.get<TwitchCategory[]>('/api/twitch/top-games'),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Games matching a submitted search (shown above the channel results). The
 *  server takes 2-60 characters. */
export function useTwitchCategories(query: string) {
  return useQuery<TwitchCategory[]>({
    queryKey: ['twitch-categories', query],
    queryFn: () => apiClient.get<TwitchCategory[]>(`/api/twitch/categories?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2 && query.trim().length <= 60,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Live streams in a game (an open game folder). Server caches 60s. */
export function useTwitchCategoryStreams(gameId: string | null) {
  return useQuery<TwitchSearchPage>({
    queryKey: ['twitch-category-streams', gameId],
    queryFn: () => apiClient.get<TwitchSearchPage>(`/api/twitch/category-streams?gameId=${encodeURIComponent(gameId!)}`),
    enabled: gameId !== null,
    staleTime: 55_000,
    retry: 1,
  });
}

/** A channel's past broadcasts, highlights or last-30-days clips (an open
 *  channel folder). Server caches 5 min. */
export function useTwitchVideos(login: string | null, type: TwitchVideoType) {
  return useQuery<TwitchVideosPage>({
    queryKey: ['twitch-videos', login, type],
    queryFn: () =>
      apiClient.get<TwitchVideosPage>(
        `/api/twitch/videos?login=${encodeURIComponent(login!)}&type=${encodeURIComponent(type)}`,
      ),
    enabled: login !== null,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
