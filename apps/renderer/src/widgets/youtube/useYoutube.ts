import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { YoutubeSearchPage, YoutubeAuthStatus, YoutubePlaylist } from '@dash/shared';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';

/** Browse tabs (videos.list, 1 quota unit) — server caches 45 min per category;
 *  the long staleTime keeps tab flips free on the client too. */
export function useYoutubeBrowse(category: string, enabled: boolean) {
  return useQuery<YoutubeSearchPage>({
    queryKey: ['youtube-browse', category],
    queryFn: () => apiClient.get<YoutubeSearchPage>(`/api/youtube/browse?category=${encodeURIComponent(category)}`),
    enabled,
    staleTime: 45 * 60 * 1000,
  });
}

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

// ── Account (Google OAuth) ────────────────────────────────────────────────────

/** Poll auth state so the widget flips to the signed-in tabs automatically
 *  after the browser OAuth round-trip completes against the server. */
export function useYoutubeAuthStatus() {
  const interval = useGatedInterval(15_000);
  return useQuery<YoutubeAuthStatus>({
    queryKey: ['youtube-auth'],
    queryFn: () => apiClient.get<YoutubeAuthStatus>('/api/youtube/auth-status'),
    refetchInterval: interval,
    staleTime: 10_000,
  });
}

export function useYoutubeConnect() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiClient.get<{ url: string }>('/api/youtube/auth-url');
      // Guarded in the main process to https://accounts.google.com/ only.
      window.electron?.openYoutubeAuth?.(url);
    },
  });
}

export function useYoutubeLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/youtube/logout'),
    onSuccess: () => {
      qc.setQueryData<YoutubeAuthStatus>(['youtube-auth'], { authenticated: false });
      void qc.invalidateQueries({ queryKey: ['youtube-subs-feed'] });
      void qc.invalidateQueries({ queryKey: ['youtube-liked'] });
      void qc.invalidateQueries({ queryKey: ['youtube-my-playlists'] });
      void qc.invalidateQueries({ queryKey: ['youtube-folder'] });
    },
  });
}

/** Newest uploads across every subscribed channel (server caches 45 min —
 *  match it client-side; the feed is the quota hog). */
export function useYoutubeSubsFeed(enabled: boolean) {
  return useQuery<YoutubeSearchPage>({
    queryKey: ['youtube-subs-feed'],
    queryFn: () => apiClient.get<YoutubeSearchPage>('/api/youtube/subscriptions-feed'),
    enabled,
    staleTime: 45 * 60 * 1000,
    retry: 1,
  });
}

export function useYoutubeLiked(enabled: boolean) {
  return useQuery<YoutubeSearchPage>({
    queryKey: ['youtube-liked'],
    queryFn: () => apiClient.get<YoutubeSearchPage>('/api/youtube/liked'),
    enabled,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}

export function useYoutubeMyPlaylists(enabled: boolean) {
  return useQuery<YoutubePlaylist[]>({
    queryKey: ['youtube-my-playlists'],
    queryFn: () => apiClient.get<YoutubePlaylist[]>('/api/youtube/my-playlists'),
    enabled,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}

/** Items of an open folder: 'channel:UC…' → that channel's uploads (public,
 *  works keyless), anything else → one of the user's playlists. */
export function useYoutubeFolderVideos(folderId: string | null) {
  return useQuery<YoutubeSearchPage>({
    queryKey: ['youtube-folder', folderId],
    queryFn: () => {
      const id = folderId!;
      return id.startsWith('channel:')
        ? apiClient.get<YoutubeSearchPage>(`/api/youtube/channel-videos?channelId=${encodeURIComponent(id.slice('channel:'.length))}`)
        : apiClient.get<YoutubeSearchPage>(`/api/youtube/playlist-videos?playlistId=${encodeURIComponent(id)}`);
    },
    enabled: folderId !== null,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}
