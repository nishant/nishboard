import type { FastifyPluginAsync } from 'fastify';
import type {
  TrackData, SpotifyAuthStatus,
  SpotifyPlaylist, SpotifyDevice,
  SpotifyPlaylistsPage, SpotifyTracksPage, SpotifyTrackItem,
  SpotifySearchResults,
} from '@dash/shared';
import crypto from 'crypto';
import { SimpleCache } from '../cache/SimpleCache';
import { HttpError, UpstreamError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';
import { UserTokenStore } from '../lib/userTokenStore';
import type { StoredUserTokens } from '../lib/userTokenStore';

// ── Token persistence ─────────────────────────────────────────────────────────
// File-backed store with single-flight refresh + clear-on-dead-refresh
// (see lib/userTokenStore for the race/rotation rationale).

const tokenStore = new UserTokenStore('spotify_tokens.json', refreshAccessToken);

// ── PKCE ──────────────────────────────────────────────────────────────────────

interface PkceState { verifier: string; state: string; expiresAt: number; }
let pendingPkce: PkceState | null = null;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// The /callback HTML page is same-origin with the whole localhost API, so any
// request-derived text must be escaped before interpolation into markup.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generatePkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  return { verifier, challenge, state };
}

// ── Spotify API helpers ───────────────────────────────────────────────────────

const SPOTIFY_ACCOUNTS = 'https://accounts.spotify.com';
const SPOTIFY_API = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
].join(' ');

const clientId = () => cred('SPOTIFY_CLIENT_ID');
// 127.0.0.1, not localhost: Spotify matches redirect URIs character-exact and
// the dashboard app has the 127.0.0.1 form registered. The server binds
// 127.0.0.1, so the callback resolves either way.
const redirectUri = () => cred('SPOTIFY_REDIRECT_URI') || 'http://127.0.0.1:7432/api/spotify/callback';

async function exchangeCode(code: string, verifier: string): Promise<StoredUserTokens> {
  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: clientId(),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed ${res.status}: ${await res.text()}`);
  const d = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  return { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + d.expires_in * 1000 };
}

async function refreshAccessToken(refreshToken: string): Promise<StoredUserTokens> {
  const res = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId(),
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed ${res.status}: ${await res.text()}`);
  const d = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? refreshToken,
    expires_at: Date.now() + d.expires_in * 1000,
  };
}

async function spotifyRequest(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const token = await tokenStore.getValidToken();
  return fetch(`${SPOTIFY_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
}

/** spotifyRequest + ok-check + JSON parse for routes that don't need the raw
 *  Response. Throws UpstreamError so the central handler passes informative
 *  statuses (401/403/429) through to the client. */
async function spotifyJson<T>(method: string, endpoint: string, label: string): Promise<T> {
  const res = await spotifyRequest(method, endpoint);
  if (!res.ok) throw new UpstreamError(res.status, `${label} ${res.status}`);
  return (await res.json()) as T;
}

/** Returns the id of the active device, or the first available one, or null.
 *  An "available but inactive" device (Spotify open in the background) can be
 *  woken up by targeting playback at its id. */
async function firstAvailableDeviceId(): Promise<string | null> {
  const res = await spotifyRequest('GET', '/me/player/devices');
  if (!res.ok) return null;
  const d = await res.json() as { devices?: { id: string; is_active: boolean }[] };
  const list = d.devices ?? [];
  if (!list.length) return null;
  return (list.find((x) => x.is_active) ?? list[0]).id;
}

/** PUT /me/player/play. If Spotify reports no active device (404), wake up any
 *  available device and retry once. Returns the final Response. */
async function startPlayback(body: Record<string, unknown>, deviceId?: string): Promise<Response> {
  const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
  let res = await spotifyRequest('PUT', `/me/player/play${qs}`, body);
  if (res.status === 404) {
    devicesCache.clear();
    const fallback = await firstAvailableDeviceId();
    if (fallback) {
      res = await spotifyRequest('PUT', `/me/player/play?device_id=${encodeURIComponent(fallback)}`, body);
    }
  }
  return res;
}

// ── Caches ────────────────────────────────────────────────────────────────────

const nowPlayingCache = new SimpleCache<TrackData>();
const devicesCache = new SimpleCache<SpotifyDevice[]>();

// Paginated caches keyed by "playlistId|offset"
const playlistPageCache = new TtlCache<string, SpotifyPlaylistsPage>(30_000);
const trackPageCache = new TtlCache<string, SpotifyTracksPage>(60_000);

// Search cache keyed by lowercased query — short TTL is fine, search rarely changes per query
const searchCache = new TtlCache<string, SpotifySearchResults>(30_000, 100);

// ── Now playing ───────────────────────────────────────────────────────────────

const NOT_PLAYING: TrackData = {
  isPlaying: false, trackId: '', trackName: '', artistName: '',
  albumName: '', albumArtUrl: '', durationMs: 0, progressMs: 0,
  shuffleState: false, repeatState: 'off', volumePercent: 0, type: 'track',
};

async function fetchNowPlaying(): Promise<TrackData> {
  const res = await spotifyRequest('GET', '/me/player?additional_types=track,episode');
  if (res.status === 204) return NOT_PLAYING;
  // UpstreamError → the central handler passes 401/403/429 straight through so
  // the client sees the real cause (403 = dev-mode allowlist) instead of a 502.
  if (!res.ok) throw new UpstreamError(res.status, `Spotify API ${res.status}`);

  const d = await res.json() as {
    is_playing: boolean;
    progress_ms: number;
    shuffle_state: boolean;
    repeat_state: 'off' | 'track' | 'context';
    device?: { volume_percent: number };
    item?: {
      type: 'track' | 'episode';
      id: string;
      name: string;
      duration_ms: number;
      // track fields
      artists?: { name: string }[];
      album?: { name: string; images: { url: string; width: number }[] };
      // episode fields
      show?: { name: string; images: { url: string; width: number }[] };
    };
  };

  if (!d.item) return { ...NOT_PLAYING, isPlaying: d.is_playing };

  const base = {
    isPlaying: d.is_playing,
    trackId: d.item.id,
    trackName: d.item.name,
    durationMs: d.item.duration_ms,
    progressMs: d.progress_ms,
    shuffleState: d.shuffle_state,
    repeatState: d.repeat_state,
    volumePercent: d.device?.volume_percent ?? 0,
  };

  if (d.item.type === 'episode') {
    const images = d.item.show?.images ?? [];
    const albumArtUrl = (images.find((img) => img.width <= 640) ?? images[0])?.url ?? '';
    return { ...base, artistName: d.item.show?.name ?? '', albumName: '', albumArtUrl, type: 'episode' };
  }

  // track
  const images = d.item.album?.images ?? [];
  const albumArtUrl = (images.find((img) => img.width <= 640) ?? images[0])?.url ?? '';
  return {
    ...base,
    artistName: (d.item.artists ?? []).map((a) => a.name).join(', '),
    albumName: d.item.album?.name ?? '',
    albumArtUrl,
    type: 'track',
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const spotifyRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/spotify/auth-url
  fastify.get('/auth-url', async (_req, reply) => {
    const { verifier, challenge, state } = generatePkce();
    pendingPkce = { verifier, state, expiresAt: Date.now() + 10 * 60 * 1000 };
    const params = new URLSearchParams({
      client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(),
      code_challenge_method: 'S256', code_challenge: challenge,
      state, scope: SCOPES, show_dialog: 'false',
    });
    return reply.send({ url: `${SPOTIFY_ACCOUNTS}/authorize?${params.toString()}` });
  });

  // GET /api/spotify/callback
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) {
        return reply.type('text/html')
          .send(`<html><body><h2>Spotify auth denied: ${escapeHtml(error)}</h2><p>You can close this tab.</p></body></html>`);
      }
      if (!code || !state || !pendingPkce || pendingPkce.state !== state) {
        return reply.code(400).type('text/html')
          .send('<html><body><h2>Invalid or expired auth request.</h2><p>Try connecting again.</p></body></html>');
      }
      if (Date.now() > pendingPkce.expiresAt) {
        pendingPkce = null;
        return reply.code(400).type('text/html')
          .send('<html><body><h2>Auth request expired.</h2><p>Try connecting again.</p></body></html>');
      }
      try {
        tokenStore.store(await exchangeCode(code, pendingPkce.verifier));
        pendingPkce = null;
        nowPlayingCache.clear();
        return reply.type('text/html')
          .send('<html><body><h2>Connected to Spotify!</h2><p>You can close this tab.</p></body></html>');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[spotify] callback error: ${msg}`);
        return reply.code(502).type('text/html')
          .send(`<html><body><h2>Token exchange failed.</h2><pre>${escapeHtml(msg)}</pre></body></html>`);
      }
    },
  );

  // GET /api/spotify/auth-status
  fastify.get<{ Reply: SpotifyAuthStatus }>('/auth-status', async (_req, reply) => {
    return reply.send({ authenticated: tokenStore.authenticated });
  });

  // POST /api/spotify/logout
  fastify.post('/logout', async (_req, reply) => {
    tokenStore.clear();
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // GET /api/spotify/now-playing
  fastify.get<{ Reply: TrackData | { error: string } }>('/now-playing', async (_req, reply) => {
    // Not logged in yet is an expected state, not a server error — return 401 so
    // the client doesn't log a 502 on every poll before the user connects.
    if (!tokenStore.authenticated) return reply.code(401).send({ error: 'Not authenticated' });
    const cached = nowPlayingCache.get();
    if (cached) return reply.send(cached);
    const data = await fetchNowPlaying();
    nowPlayingCache.set(data, 2500);
    return reply.send(data);
  });

  // Transport controls — errors propagate to the central handler (502).
  // POST /api/spotify/play
  fastify.post('/play', async (_req, reply) => {
    await spotifyRequest('PUT', '/me/player/play');
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // POST /api/spotify/pause
  fastify.post('/pause', async (_req, reply) => {
    await spotifyRequest('PUT', '/me/player/pause');
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // POST /api/spotify/next
  fastify.post('/next', async (_req, reply) => {
    await spotifyRequest('POST', '/me/player/next');
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // POST /api/spotify/previous
  fastify.post('/previous', async (_req, reply) => {
    await spotifyRequest('POST', '/me/player/previous');
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // POST /api/spotify/seek  { positionMs: number }
  fastify.post<{ Body: { positionMs: number } }>('/seek', async (req, reply) => {
    await spotifyRequest('PUT', `/me/player/seek?position_ms=${Math.round(req.body.positionMs)}`);
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // POST /api/spotify/volume  { volumePercent: number }
  fastify.post<{ Body: { volumePercent: number } }>('/volume', async (req, reply) => {
    const vol = Math.min(100, Math.max(0, Math.round(req.body.volumePercent)));
    await spotifyRequest('PUT', `/me/player/volume?volume_percent=${vol}`);
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // POST /api/spotify/shuffle  { state: boolean }
  fastify.post<{ Body: { state: boolean } }>('/shuffle', async (req, reply) => {
    await spotifyRequest('PUT', `/me/player/shuffle?state=${req.body.state}`);
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // POST /api/spotify/repeat  { state: 'off' | 'track' | 'context' }
  fastify.post<{ Body: { state: 'off' | 'track' | 'context' } }>('/repeat', async (req, reply) => {
    await spotifyRequest('PUT', `/me/player/repeat?state=${req.body.state}`);
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // GET /api/spotify/playlists?offset=0&limit=20
  // Always prepends Liked Songs at offset=0
  fastify.get<{
    Querystring: { offset?: string; limit?: string };
    Reply: SpotifyPlaylistsPage | { error: string };
  }>('/playlists', async (req, reply) => {
    const offset = Math.max(0, parseInt(req.query.offset ?? '0', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const cacheKey = `${offset}|${limit}`;

    const cached = playlistPageCache.get(cacheKey);
    if (cached) return reply.send(cached);

    // At offset 0, parallel-fetch liked songs count for the display badge
    const [playlistsRes, likedRes] = await Promise.all([
      spotifyRequest('GET', `/me/playlists?limit=${limit}&offset=${offset}`),
      offset === 0
        ? spotifyRequest('GET', '/me/tracks?limit=1&fields=total').catch(() => null)
        : Promise.resolve(null),
    ]);

    if (!playlistsRes.ok) throw new UpstreamError(playlistsRes.status, `Spotify playlists API ${playlistsRes.status}`);

    const d = await playlistsRes.json() as {
      total: number;
      offset: number;
      limit: number;
      items: {
        id: string;
        name: string;
        images: { url: string }[];
        tracks: { total: number };
        uri: string;
      }[];
    };

    const playlists: SpotifyPlaylist[] = (d.items ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      imageUrl: p.images?.[0]?.url ?? null,
      trackCount: p.tracks?.total ?? 0,
      uri: p.uri,
    }));

    let likedCount = -1;
    if (likedRes?.ok) {
      const ld = await likedRes.json() as { total: number };
      likedCount = ld.total;
    }

    const likedSongs: SpotifyPlaylist = {
      id: 'liked-songs',
      name: 'Liked Songs',
      imageUrl: null,
      trackCount: likedCount,
      uri: 'spotify:collection:tracks',
    };

    const page: SpotifyPlaylistsPage = {
      items: offset === 0 ? [likedSongs, ...playlists] : playlists,
      total: d.total,
      offset,
      limit,
    };

    playlistPageCache.set(cacheKey, page);
    return reply.send(page);
  });

  // GET /api/spotify/playlist-tracks?playlistId=...&offset=0&limit=100
  // playlistId === 'liked-songs' uses GET /me/tracks
  fastify.get<{
    Querystring: { playlistId: string; offset?: string; limit?: string };
    Reply: SpotifyTracksPage | { error: string };
  }>('/playlist-tracks', async (req, reply) => {
    const { playlistId } = req.query;
    const offset = Math.max(0, parseInt(req.query.offset ?? '0', 10));
    // Spotify /me/tracks max is 50; regular playlist items max is 100
    const isLiked = req.query.playlistId === 'liked-songs';
    const limit = Math.min(isLiked ? 50 : 100, Math.max(1, parseInt(req.query.limit ?? '100', 10)));
    const cacheKey = `${playlistId}|${offset}`;

    const cached = trackPageCache.get(cacheKey);
    if (cached) return reply.send(cached);

    let page: SpotifyTracksPage;

    if (playlistId === 'liked-songs') {
      const d = await spotifyJson<{
        total: number;
        offset: number;
        limit: number;
        items: { track: {
          id: string; name: string; duration_ms: number; uri: string; is_local: boolean;
          artists: { name: string }[];
          album: { images: { url: string }[] };
        } | null }[];
      }>('GET', `/me/tracks?limit=${limit}&offset=${offset}`, 'Spotify liked tracks API');
      const items: SpotifyTrackItem[] = (d.items ?? [])
        .filter((i) => i.track !== null)
        .map((i) => {
          const t = i.track!;
          return {
            trackId: t.id,
            trackName: t.name,
            artistName: t.artists.map((a) => a.name).join(', '),
            durationMs: t.duration_ms,
            uri: t.uri,
            type: 'track' as const,
            imageUrl: t.album.images[0]?.url ?? null,
            isLocal: t.is_local,
          };
        });
      page = { items, total: d.total, offset, limit };
    } else {
      // Regular playlist — can contain tracks and episodes
      const fields = 'total,offset,limit,items(track(type,id,name,duration_ms,uri,is_local,artists(name),album(images(url)),show(name,images(url))))';
      const d = await spotifyJson<{
        total: number;
        offset: number;
        limit: number;
        items: { track: {
          type: 'track' | 'episode';
          id: string; name: string; duration_ms: number; uri: string; is_local?: boolean;
          // track
          artists?: { name: string }[];
          album?: { images: { url: string }[] };
          // episode
          show?: { name: string; images: { url: string }[] };
        } | null }[];
      }>(
        'GET',
        `/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`,
        'Spotify playlist tracks API',
      );
      const items: SpotifyTrackItem[] = (d.items ?? [])
        .filter((i) => i.track !== null)
        .map((i) => {
          const t = i.track!;
          if (t.type === 'episode') {
            return {
              trackId: t.id,
              trackName: t.name,
              artistName: t.show?.name ?? '',
              durationMs: t.duration_ms,
              uri: t.uri,
              type: 'episode' as const,
              imageUrl: t.show?.images?.[0]?.url ?? null,
              isLocal: false,
            };
          }
          return {
            trackId: t.id,
            trackName: t.name,
            artistName: (t.artists ?? []).map((a) => a.name).join(', '),
            durationMs: t.duration_ms,
            uri: t.uri,
            type: 'track' as const,
            imageUrl: t.album?.images?.[0]?.url ?? null,
            isLocal: t.is_local ?? false,
          };
        });
      page = { items, total: d.total, offset, limit };
    }

    trackPageCache.set(cacheKey, page);
    return reply.send(page);
  });

  // GET /api/spotify/devices
  fastify.get<{ Reply: SpotifyDevice[] | { error: string } }>('/devices', async (_req, reply) => {
    const cached = devicesCache.get();
    if (cached) return reply.send(cached);
    const d = await spotifyJson<{
      devices: { id: string; name: string; type: string; is_active: boolean; volume_percent: number | null }[];
    }>('GET', '/me/player/devices', 'Spotify devices API');
    const devices: SpotifyDevice[] = (d.devices ?? []).map((dev) => ({
      id: dev.id, name: dev.name, type: dev.type, isActive: dev.is_active, volumePercent: dev.volume_percent,
    }));
    devicesCache.set(devices, 5_000);
    return reply.send(devices);
  });

  // POST /api/spotify/play-context  { contextUri, deviceId?, shuffle? }
  fastify.post<{ Body: { contextUri: string; deviceId?: string; shuffle?: boolean } }>(
    '/play-context', async (req, reply) => {
      const { contextUri, deviceId, shuffle } = req.body;
      // Set shuffle state before starting (fire-and-forget; failure is non-fatal)
      if (shuffle !== undefined) {
        await spotifyRequest('PUT', `/me/player/shuffle?state=${shuffle}`).catch(() => null);
      }
      const res = await startPlayback(
        { context_uri: contextUri, offset: { position: 0 }, position_ms: 0 },
        deviceId,
      );
      if (res.status === 404) {
        throw new HttpError(404, 'No Spotify device found — open Spotify on your phone or desktop, then try again.');
      }
      if (!res.ok && res.status !== 202) {
        throw new UpstreamError(res.status, `Spotify ${res.status}: ${await res.text()}`);
      }
      nowPlayingCache.clear();
      devicesCache.clear();
      return reply.code(204).send();
    },
  );

  // POST /api/spotify/play-track  { trackUri, contextUri?, deviceId? }
  fastify.post<{ Body: { trackUri: string; contextUri?: string; deviceId?: string } }>(
    '/play-track', async (req, reply) => {
      const { trackUri, contextUri, deviceId } = req.body;
      const playBody: Record<string, unknown> = contextUri
        ? { context_uri: contextUri, offset: { uri: trackUri }, position_ms: 0 }
        : { uris: [trackUri], position_ms: 0 };

      const res = await startPlayback(playBody, deviceId);
      if (res.status === 404) {
        throw new HttpError(404, 'No Spotify device found — open Spotify on your phone or desktop, then try again.');
      }
      if (!res.ok && res.status !== 202 && res.status !== 204) {
        throw new UpstreamError(res.status, `Spotify ${res.status}: ${await res.text()}`);
      }
      nowPlayingCache.clear();
      devicesCache.clear();
      return reply.code(204).send();
    },
  );

  // GET /api/spotify/search?q=...&limit=20
  // Returns tracks + episodes. Spotify's native ranking is already typo-tolerant.
  fastify.get<{
    Querystring: { q?: string; limit?: string };
    Reply: SpotifySearchResults | { error: string };
  }>('/search', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.send({ tracks: [], episodes: [] });

    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20', 10)));
    const cacheKey = `${limit}|${q.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached) return reply.send(cached);

    const params = new URLSearchParams({
      q, type: 'track,episode', limit: String(limit),
    });
    const d = await spotifyJson<{
      tracks?: { items: Array<{
        id: string; name: string; uri: string; duration_ms: number; is_local: boolean;
        artists: { name: string }[];
        album: { images: { url: string; width: number }[] };
      } | null> };
      episodes?: { items: Array<{
        id: string; name: string; uri: string; duration_ms: number;
        show?: { name: string; images: { url: string; width: number }[] };
        images?: { url: string; width: number }[];
      } | null> };
    }>('GET', `/search?${params.toString()}`, 'Spotify search API');

      const pickImage = (imgs: { url: string; width: number }[] | undefined): string | null => {
        if (!imgs?.length) return null;
        return (imgs.find((i) => i.width <= 300) ?? imgs[imgs.length - 1]).url;
      };

      const tracks: SpotifyTrackItem[] = (d.tracks?.items ?? [])
        .filter((t): t is NonNullable<typeof t> => t !== null)
        .map((t) => ({
          trackId: t.id,
          trackName: t.name,
          artistName: t.artists.map((a) => a.name).join(', '),
          durationMs: t.duration_ms,
          uri: t.uri,
          type: 'track' as const,
          imageUrl: pickImage(t.album?.images),
          isLocal: t.is_local,
        }));

      const episodes: SpotifyTrackItem[] = (d.episodes?.items ?? [])
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => ({
          trackId: e.id,
          trackName: e.name,
          artistName: e.show?.name ?? '',
          durationMs: e.duration_ms,
          uri: e.uri,
          type: 'episode' as const,
          imageUrl: pickImage(e.show?.images ?? e.images),
          isLocal: false,
        }));

    const data: SpotifySearchResults = { tracks, episodes };
    searchCache.set(cacheKey, data);
    return reply.send(data);
  });

  // POST /api/spotify/queue  { uri, deviceId? }
  fastify.post<{ Body: { uri: string; deviceId?: string } }>('/queue', async (req, reply) => {
    const { uri, deviceId } = req.body;
    if (!uri) throw new HttpError(400, 'uri required');
    const params = new URLSearchParams({ uri });
    if (deviceId) params.set('device_id', deviceId);
    const res = await spotifyRequest('POST', `/me/player/queue?${params.toString()}`);
    if (res.status === 404) {
      devicesCache.clear();
      throw new HttpError(404, 'No active device — open Spotify on a device first');
    }
    if (!res.ok && res.status !== 204) {
      throw new UpstreamError(res.status, `Spotify ${res.status}: ${await res.text()}`);
    }
    return reply.code(204).send();
  });
};
