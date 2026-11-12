import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '../../lib/alerts';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type {
  TrackData, SpotifyAuthStatus,
  SpotifyPlaylistsPage, SpotifyTracksPage, SpotifyDevice,
  SpotifySearchResults,
} from '@dash/shared';

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ── Connect-pending flag ──────────────────────────────────────────────────────
// Set when the auth URL is opened in the browser; the status poll runs fast
// (2s) only until the account shows as connected or 5 minutes pass.

const CONNECT_WINDOW_MS = 5 * 60_000;
let connectPendingUntil = 0;
const connectListeners = new Set<() => void>();

function setConnectPending(on: boolean): void {
  connectPendingUntil = on ? Date.now() + CONNECT_WINDOW_MS : 0;
  connectListeners.forEach((l) => l());
}

function subscribeConnect(l: () => void): () => void {
  connectListeners.add(l);
  return () => { connectListeners.delete(l); };
}

/** Exported for tests. Next status poll delay: fast while a connect is pending. */
export function statusPollMs(pendingUntil: number, authenticated: boolean, now: number): 'fast' | 'slow' {
  return !authenticated && pendingUntil > now ? 'fast' : 'slow';
}

export function useSpotifyStatus() {
  const fast = useGatedInterval(2000);
  const slow = useGatedInterval(60_000);
  // Subscribing re-renders when the flag flips so the new interval is picked up.
  useSyncExternalStore(subscribeConnect, () => connectPendingUntil);
  return useQuery<SpotifyAuthStatus>({
    queryKey: ['spotify-status'],
    queryFn: async () => {
      const st = await apiClient.get<SpotifyAuthStatus>('/api/spotify/auth-status');
      if (st.authenticated && connectPendingUntil !== 0) setConnectPending(false);
      return st;
    },
    refetchInterval: (q) =>
      statusPollMs(connectPendingUntil, q.state.data?.authenticated === true, Date.now()) === 'fast' ? fast : slow,
    staleTime: 4000,
  });
}

export function useNowPlaying(enabled = true) {
  const interval = useGatedInterval(3000);
  return useQuery<TrackData>({
    queryKey: ['spotify-now-playing'],
    queryFn: () => apiClient.get<TrackData>('/api/spotify/now-playing'),
    enabled,
    // Full rate while playing; a paused or empty player changes rarely.
    refetchInterval: (q) => (interval === false ? false : q.state.data?.isPlaying ? interval : interval * 4),
    staleTime: 2500,
  });
}

/** Fetch the auth URL, open it in the browser and start the fast status poll.
 *  Failures reach the user as a toast instead of a silent no-op. */
export function useSpotifyConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { url } = await qc.fetchQuery({
        queryKey: ['spotify-auth-url'],
        queryFn: () => apiClient.get<{ url: string }>('/api/spotify/auth-url'),
        staleTime: 0,
      });
      return url;
    },
    onSuccess: (url) => {
      if (!url) return;
      window.electron?.openSpotifyAuth(url);
      setConnectPending(true);
    },
    onError: (e: Error) => toast('Spotify', e.message, 'error'),
  });
}

// 20 playlists per page — fast initial load, scroll for more
export function usePlaylistsInfinite(enabled: boolean) {
  return useInfiniteQuery<SpotifyPlaylistsPage>({
    queryKey: ['spotify-playlists'],
    queryFn: ({ pageParam }) =>
      apiClient.get<SpotifyPlaylistsPage>(`/api/spotify/playlists?offset=${pageParam as number}&limit=20`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    enabled,
    staleTime: 25_000,
    refetchOnWindowFocus: false,
  });
}

// 100 tracks per page as requested
export function usePlaylistTracksInfinite(playlistId: string | null) {
  return useInfiniteQuery<SpotifyTracksPage>({
    queryKey: ['spotify-playlist-tracks', playlistId],
    queryFn: ({ pageParam }) =>
      apiClient.get<SpotifyTracksPage>(
        `/api/spotify/playlist-tracks?playlistId=${playlistId}&offset=${pageParam as number}&limit=100`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.total ? next : undefined;
    },
    enabled: playlistId !== null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useDevices(enabled: boolean) {
  const interval = useGatedInterval(8_000);
  return useQuery<SpotifyDevice[]>({
    queryKey: ['spotify-devices'],
    queryFn: () => apiClient.get<SpotifyDevice[]>('/api/spotify/devices'),
    enabled,
    refetchInterval: interval,
    staleTime: 5_000,
  });
}

const NOW_PLAYING_KEY = ['spotify-now-playing'] as const;
/** Spotify's player endpoint often still reports the pre-change state for a
 *  moment, so the settle refetch waits instead of overwriting the optimistic value. */
export const SETTLE_DELAY_MS = 750;

export interface OptimisticContext { previous: TrackData | undefined }

/** Cancel any in-flight poll (so it cannot land after the optimistic write),
 *  snapshot the cache for rollback, then apply the patch. */
export async function optimisticNowPlaying(
  qc: QueryClient,
  patch: Partial<TrackData>,
): Promise<OptimisticContext> {
  await qc.cancelQueries({ queryKey: NOW_PLAYING_KEY });
  const previous = qc.getQueryData<TrackData>(NOW_PLAYING_KEY);
  qc.setQueryData<TrackData>(NOW_PLAYING_KEY, (old) => (old ? { ...old, ...patch } : old));
  return { previous };
}

/** Put the snapshot back (only if there was one). */
export function rollbackNowPlaying(qc: QueryClient, ctx: OptimisticContext | undefined): void {
  if (ctx?.previous !== undefined) qc.setQueryData<TrackData>(NOW_PLAYING_KEY, ctx.previous);
}

/** Delayed settle invalidation; returns the timer id. */
export function settleNowPlaying(qc: QueryClient): ReturnType<typeof setTimeout> {
  return setTimeout(() => { void qc.invalidateQueries({ queryKey: NOW_PLAYING_KEY }); }, SETTLE_DELAY_MS);
}

// ── Playback mutations ────────────────────────────────────────────────────────

/** Shared onError for transport commands: roll back the optimistic now-playing
 *  value (by refetching the truth) and show the server's message, e.g.
 *  "No Spotify device found". */
function useTransportError() {
  const qc = useQueryClient();
  return (err: unknown, _vars?: unknown, ctx?: OptimisticContext) => {
    rollbackNowPlaying(qc, ctx);
    void qc.invalidateQueries({ queryKey: ['spotify-now-playing'] });
    toast('Spotify', err instanceof Error ? err.message : 'Command failed', 'error');
  };
}

export function usePlay() {
  const qc = useQueryClient();
  const onError = useTransportError();
  return useMutation({
    onError,
    mutationFn: () => apiClient.post('/api/spotify/play'),
    onMutate: async () => optimisticNowPlaying(qc, { isPlaying: true }),
    onSettled: () => { settleNowPlaying(qc); },
  });
}

export function usePause() {
  const qc = useQueryClient();
  const onError = useTransportError();
  return useMutation({
    onError,
    mutationFn: () => apiClient.post('/api/spotify/pause'),
    onMutate: async () => optimisticNowPlaying(qc, { isPlaying: false }),
    onSettled: () => { settleNowPlaying(qc); },
  });
}

export function useNext() {
  const qc = useQueryClient();
  const onError = useTransportError();
  return useMutation({
    onError,
    mutationFn: () => apiClient.post('/api/spotify/next'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['spotify-now-playing'] }),
  });
}

export function usePrevious() {
  const qc = useQueryClient();
  const onError = useTransportError();
  return useMutation({
    onError,
    mutationFn: () => apiClient.post('/api/spotify/previous'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['spotify-now-playing'] }),
  });
}

export function useSeek() {
  const qc = useQueryClient();
  const onError = useTransportError();
  return useMutation({
    onError,
    mutationFn: (positionMs: number) => apiClient.post('/api/spotify/seek', { positionMs: Math.max(0, Math.round(positionMs)) }),
    onMutate: async (positionMs) => optimisticNowPlaying(qc, { progressMs: positionMs }),
    onSettled: () => { settleNowPlaying(qc); },
  });
}

export const PENDING_VOLUME_MS = 5000;

export interface PendingVolume { value: number; at: number }

/** Volume the widget should show: the user's pending value until the server
 *  reports it (or PENDING_VOLUME_MS pass), else what the server says. */
export function shownVolume(serverVolume: number, pending: PendingVolume | null, now: number): number {
  if (!pending || now - pending.at >= PENDING_VOLUME_MS) return serverVolume;
  return serverVolume === pending.value ? serverVolume : pending.value;
}

export function useSpotifyVolume() {
  const qc = useQueryClient();
  const onError = useTransportError();
  const [pendingVolume, setPendingVolume] = useState<PendingVolume | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const clearPending = useCallback(() => {
    clearTimeout(timer.current);
    setPendingVolume(null);
  }, []);
  const m = useMutation({
    onError: (err: unknown, vars: number, ctx?: OptimisticContext) => {
      clearPending();
      onError(err, vars, ctx);
    },
    mutationFn: (volumePercent: number) =>
      apiClient.post('/api/spotify/volume', { volumePercent }),
    onMutate: async (volumePercent) => {
      clearTimeout(timer.current);
      setPendingVolume({ value: volumePercent, at: Date.now() });
      timer.current = setTimeout(() => setPendingVolume(null), PENDING_VOLUME_MS);
      // cancelQueries (inside) stops an in-flight poll landing after the write.
      return optimisticNowPlaying(qc, { volumePercent });
    },
    // No onSettled invalidation: Spotify reports the old volume for a moment, so
    // an immediate refetch would snap the slider back. The widget shows
    // `pendingVolume` instead of the polled value until the server reports it
    // or 5s pass; the regular poll then takes over.
  });
  return { mutate: m.mutate, pendingVolume };
}

export function useShuffle() {
  const qc = useQueryClient();
  const onError = useTransportError();
  return useMutation({
    onError,
    mutationFn: (state: boolean) => apiClient.post('/api/spotify/shuffle', { state }),
    onMutate: async (state) => optimisticNowPlaying(qc, { shuffleState: state }),
    onSettled: () => { settleNowPlaying(qc); },
  });
}

export function useRepeat() {
  const qc = useQueryClient();
  const onError = useTransportError();
  return useMutation({
    onError,
    mutationFn: (state: 'off' | 'track' | 'context') =>
      apiClient.post('/api/spotify/repeat', { state }),
    onMutate: async (state) => optimisticNowPlaying(qc, { repeatState: state }),
    onSettled: () => { settleNowPlaying(qc); },
  });
}

export function usePlayContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { contextUri: string; deviceId?: string; shuffle?: boolean }) =>
      apiClient.post('/api/spotify/play-context', args),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['spotify-now-playing'] });
      void qc.invalidateQueries({ queryKey: ['spotify-devices'] });
    },
  });
}

export function usePlayTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { trackUri: string; contextUri?: string; deviceId?: string }) =>
      apiClient.post('/api/spotify/play-track', args),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['spotify-now-playing'] });
    },
  });
}

export function useSpotifySearch(query: string, enabled: boolean) {
  const trimmed = query.trim();
  return useQuery<SpotifySearchResults>({
    queryKey: ['spotify-search', trimmed.toLowerCase()],
    queryFn: () =>
      apiClient.get<SpotifySearchResults>(
        `/api/spotify/search?q=${encodeURIComponent(trimmed)}&limit=20`,
      ),
    enabled: enabled && trimmed.length >= 2,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
}

/** Is this track in Liked Songs? Disabled for episodes / empty ids. 403 (old
 *  token missing the new scope) surfaces as isError — the heart hides. */
export function useTrackSaved(trackId: string, enabled: boolean) {
  return useQuery<{ saved: boolean }>({
    queryKey: ['spotify-track-saved', trackId],
    queryFn: () => apiClient.get<{ saved: boolean }>(`/api/spotify/track-saved?trackId=${trackId}`),
    enabled: enabled && trackId.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSaveTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { trackId: string; saved: boolean }) =>
      apiClient.post('/api/spotify/save-track', args),
    onMutate: ({ trackId, saved }) => {
      qc.setQueryData<{ saved: boolean }>(['spotify-track-saved', trackId], { saved });
    },
    onSettled: (_data, _err, { trackId }) => {
      void qc.invalidateQueries({ queryKey: ['spotify-track-saved', trackId] });
      // Liked Songs list + count badge changed
      void qc.invalidateQueries({ queryKey: ['spotify-playlist-tracks', 'liked-songs'] });
      void qc.invalidateQueries({ queryKey: ['spotify-playlists'] });
    },
  });
}

export function useQueueTrack() {
  return useMutation({
    mutationFn: (args: { uri: string; deviceId?: string }) =>
      apiClient.post('/api/spotify/queue', args),
  });
}

export function useSpotifyLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/spotify/logout'),
    onSuccess: () => {
      // Drop the previous account's data (tracks, playlists, search, devices).
      qc.removeQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === 'string'
          && q.queryKey[0].startsWith('spotify-')
          && q.queryKey[0] !== 'spotify-status',
      });
      setConnectPending(false);
      qc.setQueryData(['spotify-status'], { authenticated: false });
    },
  });
}
