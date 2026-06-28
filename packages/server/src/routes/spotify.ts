import type { FastifyPluginAsync } from 'fastify';
import type {
  TrackData, SpotifyAuthStatus,
  SpotifyPlaylist, SpotifyDevice,
  SpotifyPlaylistsPage, SpotifyTracksPage, SpotifyTrackItem,
  SpotifySearchResults,
} from '@dash/shared';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SimpleCache } from '../cache/SimpleCache';

// ── Token persistence ─────────────────────────────────────────────────────────

const TOKENS_DIR = path.join(os.homedir(), '.dash');
const TOKENS_FILE = path.join(TOKENS_DIR, 'spotify_tokens.json');

interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function loadTokens(): StoredTokens | null {
  try {
    const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function saveTokens(t: StoredTokens): void {
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(t), 'utf8');
}

let tokens: StoredTokens | null = loadTokens();

// ── PKCE ──────────────────────────────────────────────────────────────────────

interface PkceState { verifier: string; state: string; expiresAt: number; }
let pendingPkce: PkceState | null = null;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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

const clientId = () => process.env.SPOTIFY_CLIENT_ID ?? '';
const redirectUri = () => process.env.SPOTIFY_REDIRECT_URI ?? 'http://localhost:7432/api/spotify/callback';

async function exchangeCode(code: string, verifier: string): Promise<StoredTokens> {
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

async function refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
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

async function getValidToken(): Promise<string> {
  if (!tokens) throw new Error('Not authenticated');
  if (Date.now() > tokens.expires_at - 60_000) {
    tokens = await refreshAccessToken(tokens.refresh_token);
    saveTokens(tokens);
  }
  return tokens.access_token;
}

async function spotifyRequest(
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<Response> {
  const token = await getValidToken();
  return fetch(`${SPOTIFY_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Caches ────────────────────────────────────────────────────────────────────

const nowPlayingCache = new SimpleCache<TrackData>();
const devicesCache = new SimpleCache<SpotifyDevice[]>();

// Paginated caches keyed by "playlistId|offset"
const playlistPageCache = new Map<string, { data: SpotifyPlaylistsPage; expiresAt: number }>();
const trackPageCache = new Map<string, { data: SpotifyTracksPage; expiresAt: number }>();

function getPlaylistPage(key: string): SpotifyPlaylistsPage | null {
  const e = playlistPageCache.get(key);
  return e && Date.now() < e.expiresAt ? e.data : null;
}
function setPlaylistPage(key: string, data: SpotifyPlaylistsPage): void {
  playlistPageCache.set(key, { data, expiresAt: Date.now() + 30_000 });
}
function getTrackPage(key: string): SpotifyTracksPage | null {
  const e = trackPageCache.get(key);
  return e && Date.now() < e.expiresAt ? e.data : null;
}
function setTrackPage(key: string, data: SpotifyTracksPage): void {
  trackPageCache.set(key, { data, expiresAt: Date.now() + 60_000 });
}

// Search cache keyed by lowercased query — short TTL is fine, search rarely changes per query
const searchCache = new Map<string, { data: SpotifySearchResults; expiresAt: number }>();
function getSearch(key: string): SpotifySearchResults | null {
  const e = searchCache.get(key);
  return e && Date.now() < e.expiresAt ? e.data : null;
}
function setSearch(key: string, data: SpotifySearchResults): void {
  searchCache.set(key, { data, expiresAt: Date.now() + 30_000 });
  if (searchCache.size > 100) {
    const oldestKey = searchCache.keys().next().value;
    if (oldestKey !== undefined) searchCache.delete(oldestKey);
  }
}

// ── Now playing ───────────────────────────────────────────────────────────────

const NOT_PLAYING: TrackData = {
  isPlaying: false, trackId: '', trackName: '', artistName: '',
  albumName: '', albumArtUrl: '', durationMs: 0, progressMs: 0,
  shuffleState: false, repeatState: 'off', volumePercent: 0, type: 'track',
};

async function fetchNowPlaying(): Promise<TrackData> {
  const res = await spotifyRequest('GET', '/me/player?additional_types=track,episode');
  if (res.status === 204) return NOT_PLAYING;
  if (!res.ok) throw new Error(`Spotify player API ${res.status}`);

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
          .send(`<html><body><h2>Spotify auth denied: ${error}</h2><p>You can close this tab.</p></body></html>`);
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
        tokens = await exchangeCode(code, pendingPkce.verifier);
        saveTokens(tokens);
        pendingPkce = null;
        nowPlayingCache.clear();
        return reply.type('text/html')
          .send('<html><body><h2>Connected to Spotify!</h2><p>You can close this tab.</p></body></html>');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[spotify] callback error: ${msg}`);
        return reply.code(502).type('text/html')
          .send(`<html><body><h2>Token exchange failed.</h2><pre>${msg}</pre></body></html>`);
      }
    },
  );

  // GET /api/spotify/auth-status
  fastify.get<{ Reply: SpotifyAuthStatus }>('/auth-status', async (_req, reply) => {
    return reply.send({ authenticated: tokens !== null });
  });

  // POST /api/spotify/logout
  fastify.post('/logout', async (_req, reply) => {
    tokens = null;
    try { fs.unlinkSync(TOKENS_FILE); } catch { /* already gone */ }
    nowPlayingCache.clear();
    return reply.code(204).send();
  });

  // GET /api/spotify/now-playing
  fastify.get<{ Reply: TrackData | { error: string } }>('/now-playing', async (_req, reply) => {
    const cached = nowPlayingCache.get();
    if (cached) return reply.send(cached);
    try {
      const data = await fetchNowPlaying();
      nowPlayingCache.set(data, 2500);
      return reply.send(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[spotify] now-playing: ${msg}`);
      return reply.code(502).send({ error: msg });
    }
  });

  // POST /api/spotify/play
  fastify.post('/play', async (_req, reply) => {
    try {
      await spotifyRequest('PUT', '/me/player/play');
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });

  // POST /api/spotify/pause
  fastify.post('/pause', async (_req, reply) => {
    try {
      await spotifyRequest('PUT', '/me/player/pause');
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });

  // POST /api/spotify/next
  fastify.post('/next', async (_req, reply) => {
    try {
      await spotifyRequest('POST', '/me/player/next');
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });

  // POST /api/spotify/previous
  fastify.post('/previous', async (_req, reply) => {
    try {
      await spotifyRequest('POST', '/me/player/previous');
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });

  // POST /api/spotify/seek  { positionMs: number }
  fastify.post<{ Body: { positionMs: number } }>('/seek', async (req, reply) => {
    try {
      await spotifyRequest('PUT', `/me/player/seek?position_ms=${Math.round(req.body.positionMs)}`);
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });

  // POST /api/spotify/volume  { volumePercent: number }
  fastify.post<{ Body: { volumePercent: number } }>('/volume', async (req, reply) => {
    try {
      const vol = Math.min(100, Math.max(0, Math.round(req.body.volumePercent)));
      await spotifyRequest('PUT', `/me/player/volume?volume_percent=${vol}`);
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });

  // POST /api/spotify/shuffle  { state: boolean }
  fastify.post<{ Body: { state: boolean } }>('/shuffle', async (req, reply) => {
    try {
      await spotifyRequest('PUT', `/me/player/shuffle?state=${req.body.state}`);
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });

  // POST /api/spotify/repeat  { state: 'off' | 'track' | 'context' }
  fastify.post<{ Body: { state: 'off' | 'track' | 'context' } }>('/repeat', async (req, reply) => {
    try {
      await spotifyRequest('PUT', `/me/player/repeat?state=${req.body.state}`);
      nowPlayingCache.clear();
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
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

    const cached = getPlaylistPage(cacheKey);
    if (cached) return reply.send(cached);

    try {
      // At offset 0, parallel-fetch liked songs count for the display badge
      const [playlistsRes, likedRes] = await Promise.all([
        spotifyRequest('GET', `/me/playlists?limit=${limit}&offset=${offset}`),
        offset === 0
          ? spotifyRequest('GET', '/me/tracks?limit=1&fields=total').catch(() => null)
          : Promise.resolve(null),
      ]);

      if (!playlistsRes.ok) throw new Error(`Spotify playlists API ${playlistsRes.status}`);

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

      setPlaylistPage(cacheKey, page);
      return reply.send(page);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[spotify] playlists: ${msg}`);
      return reply.code(502).send({ error: msg });
    }
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

    const cached = getTrackPage(cacheKey);
    if (cached) return reply.send(cached);

    try {
      let page: SpotifyTracksPage;

      if (playlistId === 'liked-songs') {
        const res = await spotifyRequest('GET', `/me/tracks?limit=${limit}&offset=${offset}`);
        if (!res.ok) throw new Error(`Spotify liked tracks API ${res.status}`);
        const d = await res.json() as {
          total: number;
          offset: number;
          limit: number;
          items: { track: {
            id: string; name: string; duration_ms: number; uri: string; is_local: boolean;
            artists: { name: string }[];
            album: { images: { url: string }[] };
          } | null }[];
        };
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
        const res = await spotifyRequest(
          'GET',
          `/playlists/${playlistId}/items?limit=${limit}&offset=${offset}&fields=${encodeURIComponent(fields)}`,
        );
        if (!res.ok) throw new Error(`Spotify playlist tracks API ${res.status}`);
        const d = await res.json() as {
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
        };
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

      setTrackPage(cacheKey, page);
      return reply.send(page);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[spotify] playlist-tracks: ${msg}`);
      return reply.code(502).send({ error: msg });
    }
  });

  // GET /api/spotify/devices
  fastify.get<{ Reply: SpotifyDevice[] | { error: string } }>('/devices', async (_req, reply) => {
    const cached = devicesCache.get();
    if (cached) return reply.send(cached);
    try {
      const res = await spotifyRequest('GET', '/me/player/devices');
      if (!res.ok) throw new Error(`Spotify devices API ${res.status}`);
      const d = await res.json() as {
        devices: { id: string; name: string; type: string; is_active: boolean; volume_percent: number | null }[];
      };
      const devices: SpotifyDevice[] = (d.devices ?? []).map((dev) => ({
        id: dev.id, name: dev.name, type: dev.type, isActive: dev.is_active, volumePercent: dev.volume_percent,
      }));
      devicesCache.set(devices, 5_000);
      return reply.send(devices);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[spotify] devices: ${msg}`);
      return reply.code(502).send({ error: msg });
    }
  });

  // POST /api/spotify/play-context  { contextUri, deviceId?, shuffle? }
  fastify.post<{ Body: { contextUri: string; deviceId?: string; shuffle?: boolean } }>(
    '/play-context', async (req, reply) => {
      try {
        const { contextUri, deviceId, shuffle } = req.body;
        // Set shuffle state before starting (fire-and-forget; failure is non-fatal)
        if (shuffle !== undefined) {
          await spotifyRequest('PUT', `/me/player/shuffle?state=${shuffle}`).catch(() => null);
        }
        const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
        const res = await spotifyRequest('PUT', `/me/player/play${qs}`, {
          context_uri: contextUri,
          offset: { position: 0 },
          position_ms: 0,
        });
        if (res.status === 404) {
          devicesCache.clear();
          return reply.code(404).send({ error: 'No active device — open Spotify on a device first' });
        }
        if (!res.ok && res.status !== 202) {
          return reply.code(502).send({ error: `Spotify ${res.status}: ${await res.text()}` });
        }
        nowPlayingCache.clear();
        devicesCache.clear();
        return reply.code(204).send();
      } catch (err) { return reply.code(502).send({ error: String(err) }); }
    },
  );

  // POST /api/spotify/play-track  { trackUri, contextUri?, deviceId? }
  fastify.post<{ Body: { trackUri: string; contextUri?: string; deviceId?: string } }>(
    '/play-track', async (req, reply) => {
      try {
        const { trackUri, contextUri, deviceId } = req.body;
        const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
        const playBody: Record<string, unknown> = contextUri
          ? { context_uri: contextUri, offset: { uri: trackUri }, position_ms: 0 }
          : { uris: [trackUri], position_ms: 0 };

        const res = await spotifyRequest('PUT', `/me/player/play${qs}`, playBody);
        if (res.status === 404) {
          devicesCache.clear();
          return reply.code(404).send({ error: 'No active device — open Spotify on a device first' });
        }
        if (!res.ok && res.status !== 202 && res.status !== 204) {
          return reply.code(502).send({ error: `Spotify ${res.status}: ${await res.text()}` });
        }
        nowPlayingCache.clear();
        return reply.code(204).send();
      } catch (err) { return reply.code(502).send({ error: String(err) }); }
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
    const cached = getSearch(cacheKey);
    if (cached) return reply.send(cached);

    try {
      const params = new URLSearchParams({
        q, type: 'track,episode', limit: String(limit),
      });
      const res = await spotifyRequest('GET', `/search?${params.toString()}`);
      if (!res.ok) throw new Error(`Spotify search API ${res.status}: ${await res.text()}`);

      const d = await res.json() as {
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
      };

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
      setSearch(cacheKey, data);
      return reply.send(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[spotify] search: ${msg}`);
      return reply.code(502).send({ error: msg });
    }
  });

  // POST /api/spotify/queue  { uri, deviceId? }
  fastify.post<{ Body: { uri: string; deviceId?: string } }>('/queue', async (req, reply) => {
    try {
      const { uri, deviceId } = req.body;
      if (!uri) return reply.code(400).send({ error: 'uri required' });
      const params = new URLSearchParams({ uri });
      if (deviceId) params.set('device_id', deviceId);
      const res = await spotifyRequest('POST', `/me/player/queue?${params.toString()}`);
      if (res.status === 404) {
        devicesCache.clear();
        return reply.code(404).send({ error: 'No active device — open Spotify on a device first' });
      }
      if (!res.ok && res.status !== 204) {
        return reply.code(502).send({ error: `Spotify ${res.status}: ${await res.text()}` });
      }
      return reply.code(204).send();
    } catch (err) { return reply.code(502).send({ error: String(err) }); }
  });
};
