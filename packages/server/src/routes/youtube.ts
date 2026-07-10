import type { FastifyPluginAsync } from 'fastify';
import type { YoutubeVideo, YoutubeSearchPage, YoutubeAuthStatus, YoutubePlaylist, YoutubeChannel } from '@dash/shared';
import crypto from 'crypto';
import { fetchJson, HttpError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';
import { parseIso8601Duration, isShortDuration } from '../lib/youtubeDuration';
import { UserTokenStore, rethrowRefreshFailure } from '../lib/userTokenStore';
import type { StoredUserTokens } from '../lib/userTokenStore';

const BASE = 'https://www.googleapis.com/youtube/v3';

// ── User OAuth (authorization-code grant, loopback redirect) ──────────────────
// The client secret lives server-side (Google "Web application" client). This
// EXACT redirect URI must be registered on the OAuth client in Google Cloud
// console. Scope is read-only; access_type=offline + prompt=consent forces a
// refresh_token on every connect (Google only returns one on consent).
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const YT_REDIRECT_URI = 'http://localhost:7432/api/youtube/callback';
const YT_USER_SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

async function refreshYoutubeToken(refreshToken: string): Promise<StoredUserTokens> {
  // Without client credentials the token endpoint would 4xx and look like a
  // dead grant — refuse to even try, so the stored session survives until
  // credentials are configured again.
  if (!cred('YOUTUBE_CLIENT_ID') || !cred('YOUTUBE_CLIENT_SECRET')) {
    throw new HttpError(503, 'YouTube client credentials not configured — cannot refresh token');
  }
  try {
    const data = await fetchJson<{ access_token: string; expires_in: number }>(
      GOOGLE_TOKEN,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: cred('YOUTUBE_CLIENT_ID'),
          client_secret: cred('YOUTUBE_CLIENT_SECRET'),
        }),
      },
      { label: 'YouTube token refresh' },
    );
    return {
      access_token: data.access_token,
      refresh_token: refreshToken, // Google does not rotate refresh tokens
      expires_at: Date.now() + data.expires_in * 1000,
    };
  } catch (err) {
    rethrowRefreshFailure(err);
  }
}

const userTokens = new UserTokenStore('youtube_tokens.json', refreshYoutubeToken);

interface PendingAuth { state: string; expiresAt: number; }
let pendingAuth: PendingAuth | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Authorized GET against the Data API with the user token. */
async function ytUserJson<T>(pathAndQuery: string, label: string): Promise<T> {
  const token = await userTokens.getValidToken();
  return fetchJson<T>(
    `${BASE}${pathAndQuery}`,
    { headers: { Authorization: `Bearer ${token}` } },
    { label },
  );
}

// The playlistItems shape shared by the subs feed / playlist / liked mappers.
interface YtSnippet {
  title: string;
  channelTitle?: string;
  channelId?: string;
  publishedAt: string;
  thumbnails?: { medium?: { url: string }; default?: { url: string } };
  resourceId?: { videoId?: string };
  // playlistItems: the uploader is videoOwnerChannel*, channelTitle is the playlist owner
  videoOwnerChannelTitle?: string;
  videoOwnerChannelId?: string;
}

function snippetToVideo(s: YtSnippet, videoId: string): YoutubeVideo {
  return {
    videoId,
    title: s.title,
    channelTitle: s.videoOwnerChannelTitle ?? s.channelTitle ?? '',
    channelId: s.videoOwnerChannelId ?? s.channelId,
    thumbnailUrl: s.thumbnails?.medium?.url ?? s.thumbnails?.default?.url ?? '',
    publishedAt: s.publishedAt,
    // Populated by attachDurations() before the list is returned/cached.
    durationSeconds: 0,
    isShort: false,
  };
}

/** Enrich a video list with contentDetails duration + a Shorts heuristic.
 *  Every YoutubeVideo the server returns must run through this so the renderer
 *  can filter Shorts client-side. Uses the plain API key (contentDetails is
 *  public — no OAuth needed) and batches ≤50 ids/call → 1 quota unit per batch.
 *  Without an API key it leaves fields at their snippet defaults (0 / false),
 *  so the signed-in tabs still work OAuth-only, just without Short detection. */
async function attachDurations(videos: YoutubeVideo[]): Promise<YoutubeVideo[]> {
  if (videos.length === 0) return videos;
  const apiKey = cred('YOUTUBE_API_KEY');

  const durations = new Map<string, number>();
  if (apiKey) {
    for (let i = 0; i < videos.length; i += 50) {
      const ids = videos.slice(i, i + 50).map((v) => v.videoId);
      const d = await fetchJson<{
        items?: { id: string; contentDetails?: { duration?: string } }[];
      }>(
        `${BASE}/videos?part=contentDetails&id=${ids.join(',')}&key=${apiKey}`,
        undefined,
        { label: 'YouTube durations' },
      );
      for (const item of d.items ?? []) {
        durations.set(item.id, parseIso8601Duration(item.contentDetails?.duration ?? ''));
      }
    }
  }

  return videos.map((v) => {
    const durationSeconds = durations.get(v.videoId) ?? 0;
    return {
      ...v,
      durationSeconds,
      isShort: isShortDuration(durationSeconds) || /#shorts/i.test(v.title),
    };
  });
}

/** playlistItems.list → videos (used by playlists, channel uploads, subs feed).
 *  Deleted/private entries have no resourceId.videoId or a dead title — drop them. */
async function fetchPlaylistItems(playlistId: string, max: number, label: string): Promise<YoutubeVideo[]> {
  const d = await ytUserJson<{ items?: { snippet: YtSnippet }[] }>(
    `/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&maxResults=${max}`,
    label,
  );
  return (d.items ?? [])
    .filter((i) => i.snippet.resourceId?.videoId && i.snippet.title !== 'Private video' && i.snippet.title !== 'Deleted video')
    .map((i) => snippetToVideo(i.snippet, i.snippet.resourceId!.videoId!));
}

// Personal-data caches. The subs feed is the quota hog (~1 unit per subscribed
// channel per cold refresh) — 45 min keeps worst case well inside 10k/day.
const SUBS_FEED_CACHE = new TtlCache<string, YoutubeSearchPage>(45 * 60 * 1000);
const SUBS_LIST_CACHE = new TtlCache<string, YoutubeChannel[]>(30 * 60 * 1000);
const MY_PLAYLISTS_CACHE = new TtlCache<string, YoutubePlaylist[]>(15 * 60 * 1000);
const PLAYLIST_VIDEOS_CACHE = new TtlCache<string, YoutubeSearchPage>(15 * 60 * 1000);
const LIKED_CACHE = new TtlCache<string, YoutubeSearchPage>(15 * 60 * 1000);
const CHANNEL_VIDEOS_CACHE = new TtlCache<string, YoutubeSearchPage>(30 * 60 * 1000, 100);

function clearUserCaches(): void {
  SUBS_FEED_CACHE.clear();
  SUBS_LIST_CACHE.clear();
  MY_PLAYLISTS_CACHE.clear();
  PLAYLIST_VIDEOS_CACHE.clear();
  LIKED_CACHE.clear();
}

// Each search costs 100 of the 10,000/day quota units (~100 searches/day).
// The renderer's search-on-Enter + client cache is the first line of defense,
// but nothing server-side stopped a stuck client or a second window from
// burning the whole day's quota. Budget slightly under the real limit and
// cache responses so repeat queries are free.
const SEARCH_CACHE = new TtlCache<string, YoutubeSearchPage>(10 * 60 * 1000);
const DAILY_SEARCH_BUDGET = 90;
let budgetDay = '';
let searchesToday = 0;

function takeSearchBudget(): boolean {
  // YouTube quota resets at midnight Pacific; local-date granularity is close
  // enough for a personal budget.
  const today = new Date().toDateString();
  if (today !== budgetDay) {
    budgetDay = today;
    searchesToday = 0;
  }
  if (searchesToday >= DAILY_SEARCH_BUDGET) return false;
  searchesToday += 1;
  return true;
}

// Browse tabs use videos.list (chart=mostPopular) — 1 quota unit per call vs
// 100 for a search. 45-min cache per category → worst case ~96 units/day for
// all three tabs, so browse never touches the search budget.
const BROWSE_CACHE = new TtlCache<string, YoutubeSearchPage>(45 * 60 * 1000);
const BROWSE_CATEGORIES: Record<string, string | null> = {
  trending: null, // no category filter
  music: '10',
  gaming: '20',
};

export const youtubeRoutes: FastifyPluginAsync = async (fastify) => {

  // ── User OAuth ──────────────────────────────────────────────────────────────

  // GET /api/youtube/auth-url — builds the Google authorize URL; the renderer
  // opens it via the guarded youtube:open-auth IPC channel.
  fastify.get('/auth-url', async (_req, reply) => {
    if (!cred('YOUTUBE_CLIENT_ID') || !cred('YOUTUBE_CLIENT_SECRET')) {
      throw new HttpError(503, 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not configured');
    }
    const state = crypto.randomBytes(16).toString('hex');
    pendingAuth = { state, expiresAt: Date.now() + 10 * 60 * 1000 };
    const params = new URLSearchParams({
      client_id: cred('YOUTUBE_CLIENT_ID'),
      redirect_uri: YT_REDIRECT_URI,
      response_type: 'code',
      scope: YT_USER_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return reply.send({ url: `${GOOGLE_AUTH}?${params.toString()}` });
  });

  // GET /api/youtube/callback — code exchange.
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) {
        return reply.type('text/html')
          .send(`<html><body><h2>Google auth denied: ${escapeHtml(error)}</h2><p>You can close this tab.</p></body></html>`);
      }
      if (!code || !state || !pendingAuth || pendingAuth.state !== state || Date.now() > pendingAuth.expiresAt) {
        pendingAuth = null;
        return reply.code(400).type('text/html')
          .send('<html><body><h2>Invalid or expired auth request.</h2><p>Try connecting again.</p></body></html>');
      }
      try {
        const data = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number }>(
          GOOGLE_TOKEN,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: YT_REDIRECT_URI,
              client_id: cred('YOUTUBE_CLIENT_ID'),
              client_secret: cred('YOUTUBE_CLIENT_SECRET'),
            }),
          },
          { label: 'YouTube token exchange' },
        );
        // prompt=consent should always yield one; guard anyway (a re-consent
        // without it would leave us unable to refresh after ~1h).
        if (!data.refresh_token) throw new Error('Google returned no refresh_token — try connecting again');
        userTokens.store({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
        });
        pendingAuth = null;
        clearUserCaches();
        return reply.type('text/html')
          .send('<html><body><h2>Connected to YouTube!</h2><p>You can close this tab.</p></body></html>');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[youtube] callback error: ${msg}`);
        return reply.code(502).type('text/html')
          .send(`<html><body><h2>Token exchange failed.</h2><pre>${escapeHtml(msg)}</pre></body></html>`);
      }
    },
  );

  // GET /api/youtube/auth-status
  fastify.get<{ Reply: YoutubeAuthStatus }>('/auth-status', async (_req, reply) => {
    return reply.send({ authenticated: userTokens.authenticated });
  });

  // POST /api/youtube/logout
  fastify.post('/logout', async (_req, reply) => {
    userTokens.clear();
    clearUserCaches();
    return reply.code(204).send();
  });

  // ── Personal data (OAuth) ───────────────────────────────────────────────────

  // GET /api/youtube/subscriptions-feed — newest uploads across every
  // subscribed channel. Quota ≈ 1 (subs) + ceil(N/50) (channels) + N
  // (playlistItems) per cold refresh; 45-min cache.
  fastify.get<{ Reply: YoutubeSearchPage | { error: string } }>('/subscriptions-feed', async (_req, reply) => {
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to YouTube' });

    const cached = SUBS_FEED_CACHE.get('feed');
    if (cached) return reply.send(cached);

    // Subscribed channels — one page of 50 covers most personal accounts; take
    // a second page when needed and cap at 100 (quota guard).
    const channelIds: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 2; page++) {
      const d = await ytUserJson<{
        nextPageToken?: string;
        items?: { snippet: { resourceId?: { channelId?: string } } }[];
      }>(
        `/subscriptions?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`,
        'YouTube subscriptions',
      );
      for (const i of d.items ?? []) {
        const id = i.snippet.resourceId?.channelId;
        if (id) channelIds.push(id);
      }
      pageToken = d.nextPageToken;
      if (!pageToken) break;
    }

    // Uploads playlist id per channel (batched, ≤50 ids per call).
    const uploads: string[] = [];
    for (let i = 0; i < channelIds.length; i += 50) {
      const batch = channelIds.slice(i, i + 50);
      const d = await ytUserJson<{
        items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
      }>(`/channels?part=contentDetails&id=${batch.join(',')}&maxResults=50`, 'YouTube channels');
      for (const c of d.items ?? []) {
        const u = c.contentDetails?.relatedPlaylists?.uploads;
        if (u) uploads.push(u);
      }
    }

    // Newest few uploads from each channel, bounded concurrency.
    const CONCURRENCY = 8;
    const videos: YoutubeVideo[] = [];
    for (let i = 0; i < uploads.length; i += CONCURRENCY) {
      const batch = uploads.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((pl) => fetchPlaylistItems(pl, 5, 'YouTube uploads')),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') videos.push(...r.value);
        // rejected: single dead channel shouldn't kill the whole feed
      }
    }

    videos.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
    const page: YoutubeSearchPage = {
      items: await attachDurations(videos.slice(0, 60)),
      nextPageToken: null,
    };
    SUBS_FEED_CACHE.set('feed', page);
    return reply.send(page);
  });

  // GET /api/youtube/subscriptions-list — just the channels you're subscribed
  // to (avatar + name), for the Subs "channel list only" mode. The snippet the
  // subs-feed already fetches carries the title + thumbnails, so this is a plain
  // ~1 quota unit per page (no channels.list / playlistItems). 30-min cache.
  fastify.get<{ Reply: YoutubeChannel[] | { error: string } }>('/subscriptions-list', async (_req, reply) => {
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to YouTube' });

    const cached = SUBS_LIST_CACHE.get('list');
    if (cached) return reply.send(cached);

    // Same paginated subscriptions fetch as the feed (up to 2 pages / 100
    // channels), but map the full snippet instead of only the channelId.
    const byId = new Map<string, YoutubeChannel>();
    let pageToken: string | undefined;
    for (let page = 0; page < 2; page++) {
      const d = await ytUserJson<{
        nextPageToken?: string;
        items?: {
          snippet: {
            title: string;
            resourceId?: { channelId?: string };
            thumbnails?: { medium?: { url: string }; default?: { url: string } };
          };
        }[];
      }>(
        `/subscriptions?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ''}`,
        'YouTube subscriptions',
      );
      for (const i of d.items ?? []) {
        // resourceId.channelId is the SUBSCRIBED channel — not the snippet's own.
        const channelId = i.snippet.resourceId?.channelId;
        if (!channelId || byId.has(channelId)) continue;
        byId.set(channelId, {
          channelId,
          title: i.snippet.title,
          thumbnailUrl: i.snippet.thumbnails?.medium?.url ?? i.snippet.thumbnails?.default?.url ?? '',
        });
      }
      pageToken = d.nextPageToken;
      if (!pageToken) break;
    }

    const channels = [...byId.values()].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
    );
    SUBS_LIST_CACHE.set('list', channels);
    return reply.send(channels);
  });

  // GET /api/youtube/my-playlists
  fastify.get<{ Reply: YoutubePlaylist[] | { error: string } }>('/my-playlists', async (_req, reply) => {
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to YouTube' });

    const cached = MY_PLAYLISTS_CACHE.get('mine');
    if (cached) return reply.send(cached);

    const d = await ytUserJson<{
      items?: {
        id: string;
        snippet: { title: string; thumbnails?: { medium?: { url: string }; default?: { url: string } } };
        contentDetails?: { itemCount?: number };
      }[];
    }>('/playlists?part=snippet,contentDetails&mine=true&maxResults=50', 'YouTube playlists');

    const playlists: YoutubePlaylist[] = (d.items ?? []).map((p) => ({
      id: p.id,
      title: p.snippet.title,
      videoCount: p.contentDetails?.itemCount ?? 0,
      thumbnailUrl: p.snippet.thumbnails?.medium?.url ?? p.snippet.thumbnails?.default?.url ?? null,
    }));
    MY_PLAYLISTS_CACHE.set('mine', playlists);
    return reply.send(playlists);
  });

  // GET /api/youtube/playlist-videos?playlistId=...
  fastify.get<{
    Querystring: { playlistId?: string };
    Reply: YoutubeSearchPage | { error: string };
  }>('/playlist-videos', async (req, reply) => {
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to YouTube' });
    const playlistId = (req.query.playlistId ?? '').trim();
    if (!/^[A-Za-z0-9_-]{10,60}$/.test(playlistId)) throw new HttpError(400, 'playlistId required');

    const cached = PLAYLIST_VIDEOS_CACHE.get(playlistId);
    if (cached) return reply.send(cached);

    const page: YoutubeSearchPage = {
      items: await attachDurations(await fetchPlaylistItems(playlistId, 50, 'YouTube playlist videos')),
      nextPageToken: null,
    };
    PLAYLIST_VIDEOS_CACHE.set(playlistId, page);
    return reply.send(page);
  });

  // GET /api/youtube/liked — videos.list?myRating=like (playlistItems on 'LL'
  // is dead API surface; myRating is the supported path).
  fastify.get<{ Reply: YoutubeSearchPage | { error: string } }>('/liked', async (_req, reply) => {
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to YouTube' });

    const cached = LIKED_CACHE.get('liked');
    if (cached) return reply.send(cached);

    // /liked already calls videos.list, so fold contentDetails into the same
    // request (+0 quota) and set the duration fields inline — no attachDurations
    // round-trip needed here.
    const d = await ytUserJson<{
      items?: { id: string; snippet: YtSnippet; contentDetails?: { duration?: string } }[];
    }>('/videos?part=snippet,contentDetails&myRating=like&maxResults=50', 'YouTube liked');

    const page: YoutubeSearchPage = {
      items: (d.items ?? []).map((v) => {
        const durationSeconds = parseIso8601Duration(v.contentDetails?.duration ?? '');
        return {
          ...snippetToVideo(v.snippet, v.id),
          durationSeconds,
          isShort: isShortDuration(durationSeconds) || /#shorts/i.test(v.snippet.title),
        };
      }),
      nextPageToken: null,
    };
    LIKED_CACHE.set('liked', page);
    return reply.send(page);
  });

  // GET /api/youtube/channel-videos?channelId=... — a channel's newest uploads.
  // Public data: works with the plain API key (no OAuth needed), falling back
  // to the user token when only OAuth is configured.
  fastify.get<{
    Querystring: { channelId?: string };
    Reply: YoutubeSearchPage | { error: string };
  }>('/channel-videos', async (req, reply) => {
    const channelId = (req.query.channelId ?? '').trim();
    if (!/^UC[A-Za-z0-9_-]{10,40}$/.test(channelId)) throw new HttpError(400, 'channelId required');

    const cached = CHANNEL_VIDEOS_CACHE.get(channelId);
    if (cached) return reply.send(cached);

    const apiKey = cred('YOUTUBE_API_KEY');
    const useKey = apiKey !== '';
    if (!useKey && !userTokens.authenticated) {
      throw new HttpError(503, 'YOUTUBE_API_KEY not configured');
    }

    const get = async <T>(pathAndQuery: string, label: string): Promise<T> =>
      useKey
        ? fetchJson<T>(`${BASE}${pathAndQuery}&key=${apiKey}`, undefined, { label })
        : ytUserJson<T>(pathAndQuery, label);

    // Channel uploads playlist = 'UU' + channel suffix, but resolve it properly
    // (1 unit) instead of assuming the convention.
    const ch = await get<{
      items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
    }>(`/channels?part=contentDetails&id=${channelId}`, 'YouTube channel');
    const uploadsId = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) throw new HttpError(404, 'Channel not found');

    const items = await get<{ items?: { snippet: YtSnippet }[] }>(
      `/playlistItems?part=snippet&playlistId=${encodeURIComponent(uploadsId)}&maxResults=30`,
      'YouTube channel videos',
    );
    const page: YoutubeSearchPage = {
      items: await attachDurations(
        (items.items ?? [])
          .filter((i) => i.snippet.resourceId?.videoId && i.snippet.title !== 'Private video' && i.snippet.title !== 'Deleted video')
          .map((i) => snippetToVideo(i.snippet, i.snippet.resourceId!.videoId!)),
      ),
      nextPageToken: null,
    };
    CHANNEL_VIDEOS_CACHE.set(channelId, page);
    return reply.send(page);
  });

  // GET /api/youtube/embed?videoId=...
  // Serves a minimal HTML page embedding the YouTube player. The parent origin
  // becomes http://localhost:7432 instead of file://, which YouTube accepts.
  fastify.get<{ Querystring: { videoId: string } }>('/embed', async (req, reply) => {
    const { videoId } = req.query;
    if (!videoId || !/^[A-Za-z0-9_-]{6,16}$/.test(videoId)) {
      return reply.status(400).send('Invalid videoId');
    }
    const embedSrc = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="referrer" content="origin">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body,iframe{width:100%;height:100%;border:none;background:#000}</style>
</head>
<body>
<iframe src="${embedSrc}" allow="autoplay;encrypted-media;fullscreen;picture-in-picture" allowfullscreen></iframe>
</body>
</html>`;
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // GET /api/youtube/browse?category=trending|music|gaming
  fastify.get<{ Querystring: { category?: string } }>('/browse', async (req, reply) => {
    const apiKey = cred('YOUTUBE_API_KEY');
    if (!apiKey) throw new HttpError(503, 'YOUTUBE_API_KEY not configured');

    const category = req.query.category ?? 'trending';
    if (!(category in BROWSE_CATEGORIES)) throw new HttpError(400, 'Unknown category');

    const cached = BROWSE_CACHE.get(category);
    if (cached) return reply.send(cached);

    const url = new URL(`${BASE}/videos`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('chart', 'mostPopular');
    url.searchParams.set('regionCode', 'US');
    url.searchParams.set('maxResults', '12');
    const categoryId = BROWSE_CATEGORIES[category];
    if (categoryId) url.searchParams.set('videoCategoryId', categoryId);
    url.searchParams.set('key', apiKey);

    // videos.list returns `id` as a plain string (search.list wraps it in {videoId}).
    const data = await fetchJson<{
      items?: Array<{
        id: string;
        snippet: {
          title: string;
          channelTitle: string;
          channelId?: string;
          thumbnails: { medium?: { url: string }; default?: { url: string } };
          publishedAt: string;
        };
      }>;
    }>(url.toString(), undefined, { label: 'YouTube API' });

    const page: YoutubeSearchPage = {
      nextPageToken: null,
      items: await attachDurations((data.items ?? []).map((item): YoutubeVideo => ({
        videoId: item.id,
        title: decodeHTMLEntities(item.snippet.title),
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        thumbnailUrl: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
        publishedAt: item.snippet.publishedAt,
        durationSeconds: 0,
        isShort: false,
      }))),
    };

    BROWSE_CACHE.set(category, page);
    return reply.send(page);
  });

  // GET /api/youtube/search?q=...&pageToken=...
  fastify.get<{
    Querystring: { q: string; pageToken?: string };
  }>('/search', async (req, reply) => {
    const apiKey = cred('YOUTUBE_API_KEY');
    if (!apiKey) throw new HttpError(503, 'YOUTUBE_API_KEY not configured');

    const { q, pageToken } = req.query;
    if (!q?.trim()) throw new HttpError(400, 'q is required');

    const cacheKey = `${q.trim().toLowerCase()}|${pageToken ?? ''}`;
    const cached = SEARCH_CACHE.get(cacheKey);
    if (cached) return reply.send(cached);

    if (!takeSearchBudget()) {
      throw new HttpError(429, 'Daily YouTube search budget reached — resets tomorrow');
    }

    const url = new URL(`${BASE}/search`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', q.trim());
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '12');
    url.searchParams.set('safeSearch', 'none');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const data = await fetchJson<{
      nextPageToken?: string;
      items?: Array<{
        id: { videoId: string };
        snippet: {
          title: string;
          channelTitle: string;
          channelId?: string;
          thumbnails: { medium?: { url: string }; default?: { url: string } };
          publishedAt: string;
        };
      }>;
    }>(url.toString(), undefined, { label: 'YouTube API' });

    const page: YoutubeSearchPage = {
      nextPageToken: data.nextPageToken ?? null,
      items: await attachDurations((data.items ?? []).map((item): YoutubeVideo => ({
        videoId: item.id.videoId,
        title: decodeHTMLEntities(item.snippet.title),
        channelTitle: item.snippet.channelTitle,
        channelId: item.snippet.channelId,
        thumbnailUrl: item.snippet.thumbnails.medium?.url ?? item.snippet.thumbnails.default?.url ?? '',
        publishedAt: item.snippet.publishedAt,
        durationSeconds: 0,
        isShort: false,
      }))),
    };

    SEARCH_CACHE.set(cacheKey, page);
    return reply.send(page);
  });
};

// YouTube API returns HTML-encoded titles (&amp; etc)
function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
