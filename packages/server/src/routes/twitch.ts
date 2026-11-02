import type { FastifyPluginAsync } from 'fastify';
import type {
  TwitchChannel, TwitchSearchPage, TwitchAuthStatus, TwitchVideosPage, TwitchVideoType, TwitchCategory,
} from '@dash/shared';
import crypto from 'crypto';
import { fetchJson, HttpError, UpstreamError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';
import { UserTokenStore, rethrowRefreshFailure } from '../lib/userTokenStore';
import type { StoredUserTokens } from '../lib/userTokenStore';
import { mapCategory, mapClip, mapStream, mapVideo } from '../lib/twitchHelix';
import type { HelixCategory, HelixClip, HelixStream, HelixVideo } from '../lib/twitchHelix';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const HELIX = 'https://api.twitch.tv/helix';

// ── User OAuth (authorization-code grant) ─────────────────────────────────────
// The client secret lives server-side, so no PKCE needed. This EXACT redirect
// URI must be registered in the Twitch dev console for the app.
const REDIRECT_URI = 'http://localhost:7432/api/twitch/callback';
const USER_SCOPES = 'user:read:follows';

async function refreshUserToken(refreshToken: string): Promise<StoredUserTokens> {
  // Without client credentials the token endpoint would 4xx and look like a
  // dead grant — refuse to even try, so the stored session survives until
  // credentials are configured again.
  if (!cred('TWITCH_CLIENT_ID') || !cred('TWITCH_CLIENT_SECRET')) {
    throw new HttpError(503, 'Twitch client credentials not configured — cannot refresh token');
  }
  try {
    const data = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number }>(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: cred('TWITCH_CLIENT_ID'),
          client_secret: cred('TWITCH_CLIENT_SECRET'),
        }),
      },
      { label: 'Twitch token refresh' },
    );
    return {
      access_token: data.access_token,
      // Twitch rotates refresh tokens — fall back defensively.
      refresh_token: data.refresh_token ?? refreshToken,
      expires_at: Date.now() + data.expires_in * 1000,
    };
  } catch (err) {
    rethrowRefreshFailure(err);
  }
}

// Twitch user tokens are short (~4h) and refresh-rotated → the shared store's
// single-flight refresh is load-bearing here, not just defensive.
const userTokens = new UserTokenStore('twitch_tokens.json', refreshUserToken);

interface PendingAuth { state: string; expiresAt: number; }
let pendingAuth: PendingAuth | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// App access token cache (client-credentials grant). Search needs no user
// context, so a client-credentials token is all the auth required. Twitch
// tokens last ~60 days; we refresh a minute early and on any 401.
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const url = new URL(TOKEN_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const data = await fetchJson<{ access_token: string; expires_in: number }>(
    url.toString(),
    { method: 'POST' },
    { label: 'Twitch token' },
  );
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

/** App-token Helix GET. Missing credentials → 503; a 401 drops the cached token
 *  and retries once with a fresh one. */
async function helixApp<T>(path: string, build: (u: URL) => void, label: string): Promise<T> {
  const clientId = cred('TWITCH_CLIENT_ID');
  const clientSecret = cred('TWITCH_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new HttpError(503, 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not configured');
  }
  for (let attempt = 0; ; attempt++) {
    const url = new URL(`${HELIX}/${path}`);
    build(url);
    try {
      const token = await getAppToken(clientId, clientSecret);
      return await fetchJson<T>(
        url.toString(),
        { headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` } },
        { label },
      );
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 401 && attempt === 0) {
        cachedToken = null;
        continue;
      }
      throw err;
    }
  }
}

const LOGIN_RE = /^[A-Za-z0-9_]{1,25}$/;
const CURSOR_RE = /^[A-Za-z0-9+/=_-]{1,400}$/;
const GAME_ID_RE = /^\d{1,20}$/;
const VIDEO_ID_RE = /^\d{1,20}$/;
const CLIP_SLUG_RE = /^[A-Za-z0-9_-]{1,100}$/;
const VIDEO_TYPES: readonly TwitchVideoType[] = ['archive', 'highlight', 'upload', 'clips'];

const userIdCache = new TtlCache<string, string>(24 * 60 * 60_000);
const videosCache = new TtlCache<string, TwitchVideosPage>(5 * 60_000);
const categoriesCache = new TtlCache<string, TwitchCategory[]>(10 * 60_000);
const topGamesCache = new TtlCache<string, TwitchCategory[]>(10 * 60_000);
const categoryStreamsCache = new TtlCache<string, TwitchSearchPage>(60_000);

function isVideoType(t: string): t is TwitchVideoType {
  return (VIDEO_TYPES as readonly string[]).includes(t);
}

function validCursor(after: string | undefined): string | undefined {
  if (!after) return undefined;
  if (!CURSOR_RE.test(after)) throw new HttpError(400, 'Invalid cursor');
  return after;
}

// 60s cache — followed-live status doesn't move faster, and the widget refetch
// on tab focus stays cheap.
const followedCache = new TtlCache<string, TwitchSearchPage>(60_000);

// Follow list + avatars move much slower than live status: 5 min for the
// follow/avatar set, while the merged all-channels page still refreshes its
// live flags from the 60s live cache on every miss.
interface FollowedChannelMeta {
  id: string;
  login: string;
  displayName: string;
  avatarUrl: string;
}
const followsCache = new TtlCache<string, FollowedChannelMeta[]>(5 * 60_000);
const followedAllCache = new TtlCache<string, TwitchSearchPage>(60_000);

/** Live streams the user follows (helix streams/followed), 60s-cached.
 *  Shared by /followed (the Live tab) and /followed-all (live-flag merge). */
async function fetchFollowedLive(token: string, userId: string): Promise<TwitchSearchPage> {
  const cached = followedCache.get('followed');
  if (cached) return cached;

  const url = new URL(`${HELIX}/streams/followed`);
  url.searchParams.set('user_id', userId);
  url.searchParams.set('first', '20');
  const data = await fetchJson<{
    data: Array<{
      user_id: string;
      user_login: string;
      user_name: string;
      title: string;
      game_name: string;
      thumbnail_url: string;
      started_at: string;
    }>;
  }>(
    url.toString(),
    { headers: { 'Client-Id': cred('TWITCH_CLIENT_ID'), Authorization: `Bearer ${token}` } },
    { label: 'Twitch followed' },
  );

  const page: TwitchSearchPage = {
    nextCursor: null,
    items: data.data.map((s): TwitchChannel => ({
      id: s.user_id,
      login: s.user_login,
      displayName: s.user_name,
      // Stream thumbnails are templated: ...-{width}x{height}.jpg
      thumbnailUrl: s.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
      isLive: true,
      title: s.title,
      gameName: s.game_name,
      startedAt: s.started_at || null,
    })),
  };
  followedCache.set('followed', page);
  return page;
}

/** Everyone the user follows (helix channels/followed) with profile avatars
 *  (helix users, batched — both endpoints page at 100, one page covers a
 *  personal follow list). 5 min cache. */
async function fetchFollows(token: string, userId: string): Promise<FollowedChannelMeta[]> {
  const cached = followsCache.get(userId);
  if (cached) return cached;

  const headers = { 'Client-Id': cred('TWITCH_CLIENT_ID'), Authorization: `Bearer ${token}` };
  const url = new URL(`${HELIX}/channels/followed`);
  url.searchParams.set('user_id', userId);
  url.searchParams.set('first', '100');
  const data = await fetchJson<{
    data: Array<{ broadcaster_id: string; broadcaster_login: string; broadcaster_name: string }>;
  }>(url.toString(), { headers }, { label: 'Twitch follows' });

  // channels/followed carries no images — resolve avatars via /users (≤100 ids/call).
  let avatars = new Map<string, string>();
  if (data.data.length > 0) {
    const usersUrl = new URL(`${HELIX}/users`);
    for (const f of data.data) usersUrl.searchParams.append('id', f.broadcaster_id);
    const users = await fetchJson<{ data: Array<{ id: string; profile_image_url: string }> }>(
      usersUrl.toString(),
      { headers },
      { label: 'Twitch users' },
    );
    avatars = new Map(users.data.map((u) => [u.id, u.profile_image_url]));
  }

  const follows: FollowedChannelMeta[] = data.data.map((f) => ({
    id: f.broadcaster_id,
    login: f.broadcaster_login,
    displayName: f.broadcaster_name,
    avatarUrl: avatars.get(f.broadcaster_id) ?? '',
  }));
  followsCache.set(userId, follows);
  return follows;
}

export const twitchRoutes: FastifyPluginAsync = async (fastify) => {

  // ── User OAuth ────────────────────────────────────────────────────────────

  // GET /api/twitch/auth-url — builds the authorize URL; the renderer opens it
  // via the guarded twitch:open-auth IPC channel.
  fastify.get('/auth-url', async (_req, reply) => {
    if (!cred('TWITCH_CLIENT_ID') || !cred('TWITCH_CLIENT_SECRET')) {
      throw new HttpError(503, 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not configured');
    }
    const state = crypto.randomBytes(16).toString('hex');
    pendingAuth = { state, expiresAt: Date.now() + 10 * 60 * 1000 };
    const params = new URLSearchParams({
      client_id: cred('TWITCH_CLIENT_ID'),
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: USER_SCOPES,
      state,
    });
    return reply.send({ url: `${AUTHORIZE_URL}?${params.toString()}` });
  });

  // GET /api/twitch/callback — code exchange + resolve the user id once
  // (persisted in token meta; /streams/followed needs it on every call).
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) {
        return reply.type('text/html')
          .send(`<html><body><h2>Twitch auth denied: ${escapeHtml(error)}</h2><p>You can close this tab.</p></body></html>`);
      }
      if (!code || !state || !pendingAuth || pendingAuth.state !== state || Date.now() > pendingAuth.expiresAt) {
        pendingAuth = null;
        return reply.code(400).type('text/html')
          .send('<html><body><h2>Invalid or expired auth request.</h2><p>Try connecting again.</p></body></html>');
      }
      try {
        const data = await fetchJson<{ access_token: string; refresh_token: string; expires_in: number }>(
          TOKEN_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: REDIRECT_URI,
              client_id: cred('TWITCH_CLIENT_ID'),
              client_secret: cred('TWITCH_CLIENT_SECRET'),
            }),
          },
          { label: 'Twitch token exchange' },
        );
        // /helix/users with a user token (no id param) returns the token's owner.
        const users = await fetchJson<{ data: { id: string }[] }>(
          `${HELIX}/users`,
          { headers: { 'Client-Id': cred('TWITCH_CLIENT_ID'), Authorization: `Bearer ${data.access_token}` } },
          { label: 'Twitch users' },
        );
        const userId = users.data[0]?.id;
        if (!userId) throw new Error('Could not resolve Twitch user id');
        userTokens.store({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
          meta: { userId },
        });
        pendingAuth = null;
        followedCache.clear();
        followsCache.clear();
        followedAllCache.clear();
        return reply.type('text/html')
          .send('<html><body><h2>Connected to Twitch!</h2><p>You can close this tab.</p></body></html>');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[twitch] callback error: ${msg}`);
        return reply.code(502).type('text/html')
          .send(`<html><body><h2>Token exchange failed.</h2><pre>${escapeHtml(msg)}</pre></body></html>`);
      }
    },
  );

  // GET /api/twitch/auth-status
  fastify.get<{ Reply: TwitchAuthStatus }>('/auth-status', async (_req, reply) => {
    return reply.send({ authenticated: userTokens.authenticated });
  });

  // POST /api/twitch/logout
  fastify.post('/logout', async (_req, reply) => {
    userTokens.clear();
    followedCache.clear();
    followsCache.clear();
    followedAllCache.clear();
    return reply.code(204).send();
  });

  // GET /api/twitch/followed — live channels the connected user follows.
  fastify.get<{ Reply: TwitchSearchPage | { error: string } }>('/followed', async (_req, reply) => {
    // Not connected is an expected state (the Following tab shows Connect) —
    // 401, not 5xx, so the client poll doesn't read as a server failure.
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to Twitch' });

    const token = await userTokens.getValidToken();
    const userId = userTokens.meta?.userId;
    if (!userId) {
      userTokens.clear();
      return reply.code(401).send({ error: 'Twitch session incomplete — reconnect' });
    }

    return reply.send(await fetchFollowedLive(token, userId));
  });

  // GET /api/twitch/followed-all — every channel the user follows, live first
  // (then alphabetical). Live entries carry the stream title/game; offline rows
  // show the profile avatar and empty stream fields.
  fastify.get<{ Reply: TwitchSearchPage | { error: string } }>('/followed-all', async (_req, reply) => {
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to Twitch' });

    const cached = followedAllCache.get('all');
    if (cached) return reply.send(cached);

    const token = await userTokens.getValidToken();
    const userId = userTokens.meta?.userId;
    if (!userId) {
      userTokens.clear();
      return reply.code(401).send({ error: 'Twitch session incomplete — reconnect' });
    }

    const [follows, live] = await Promise.all([
      fetchFollows(token, userId),
      fetchFollowedLive(token, userId),
    ]);
    const liveById = new Map(live.items.map((s) => [s.id, s]));

    const items = follows
      .map((f): TwitchChannel => {
        const s = liveById.get(f.id);
        return {
          id: f.id,
          login: f.login,
          displayName: f.displayName,
          // Avatar (not stream still) for every row — the All list is a channel
          // directory, and the round thumb shape expects a profile image.
          thumbnailUrl: f.avatarUrl,
          isLive: s !== undefined,
          title: s?.title ?? '',
          gameName: s?.gameName ?? '',
          startedAt: s?.startedAt ?? null,
        };
      })
      .sort((a, b) =>
        a.isLive === b.isLive
          ? a.displayName.localeCompare(b.displayName)
          : (a.isLive ? -1 : 1),
      );

    const page: TwitchSearchPage = { nextCursor: null, items };
    followedAllCache.set('all', page);
    return reply.send(page);
  });

  // GET /api/twitch/embed?channel=... | ?video=<id> | ?clip=<slug>
  // Serves a minimal HTML page wrapping the Twitch player. The parent origin
  // becomes http://localhost:7432, which matches the parent= param Twitch requires.
  fastify.get<{ Querystring: { channel?: string; video?: string; clip?: string } }>('/embed', async (req, reply) => {
    const { channel, video, clip } = req.query;
    const given = [channel, video, clip].filter((v) => v !== undefined);
    let src = '';
    if (given.length === 1) {
      if (channel !== undefined && LOGIN_RE.test(channel)) {
        src = `https://player.twitch.tv/?channel=${channel}&parent=localhost&autoplay=true`;
      } else if (video !== undefined && VIDEO_ID_RE.test(video)) {
        src = `https://player.twitch.tv/?video=v${video}&parent=localhost&autoplay=true`;
      } else if (clip !== undefined && CLIP_SLUG_RE.test(clip)) {
        src = `https://clips.twitch.tv/embed?clip=${clip}&parent=localhost&autoplay=true`;
      }
    }
    if (!src) return reply.status(400).send('Invalid embed target');
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body,iframe{width:100%;height:100%;border:none;background:#000}</style>
</head>
<body>
<iframe src="${src}" allow="autoplay;encrypted-media;fullscreen;picture-in-picture" allowfullscreen></iframe>
</body>
</html>`;
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // GET /api/twitch/search?q=...&after=...
  fastify.get<{
    Querystring: { q: string; after?: string };
  }>('/search', async (req, reply) => {
    if (!cred('TWITCH_CLIENT_ID') || !cred('TWITCH_CLIENT_SECRET')) {
      throw new HttpError(503, 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not configured');
    }

    const { q, after } = req.query;
    if (!q?.trim()) throw new HttpError(400, 'q is required');

    const data = await helixApp<{
      pagination?: { cursor?: string };
      data: Array<{
        id: string;
        broadcaster_login: string;
        display_name: string;
        thumbnail_url: string;
        is_live: boolean;
        title: string;
        game_name: string;
        started_at: string;
      }>;
    }>(
      'search/channels',
      (u) => {
        u.searchParams.set('query', q.trim());
        u.searchParams.set('first', '12');
        if (after) u.searchParams.set('after', after);
      },
      'Twitch API',
    );

    const page: TwitchSearchPage = {
      nextCursor: data.pagination?.cursor ?? null,
      items: data.data.map((c): TwitchChannel => ({
        id: c.id,
        login: c.broadcaster_login,
        displayName: c.display_name,
        thumbnailUrl: c.thumbnail_url,
        isLive: c.is_live,
        title: c.title,
        gameName: c.game_name,
        startedAt: c.started_at || null,
      })),
    };

    return reply.send(page);
  });

  // GET /api/twitch/videos?login=&type=archive|highlight|upload|clips&after=
  fastify.get<{ Querystring: { login?: string; type?: string; after?: string } }>('/videos', async (req, reply) => {
    const login = (req.query.login ?? '').trim();
    if (!LOGIN_RE.test(login)) throw new HttpError(400, 'Invalid login');
    const type = req.query.type ?? 'archive';
    if (!isVideoType(type)) throw new HttpError(400, 'type must be archive, highlight, upload or clips');
    const after = validCursor(req.query.after);
    const name = login.toLowerCase();

    const key = `${name}|${type}|${after ?? ''}`;
    const cached = videosCache.get(key);
    if (cached) return reply.send(cached);

    let userId = userIdCache.get(name);
    if (!userId) {
      const users = await helixApp<{ data?: Array<{ id?: string }> }>(
        'users',
        (u) => u.searchParams.set('login', name),
        'Twitch users',
      );
      userId = users.data?.[0]?.id ?? null;
      if (!userId) throw new HttpError(404, 'No Twitch channel by that name');
      userIdCache.set(name, userId);
    }
    const id = userId;

    let page: TwitchVideosPage;
    if (type === 'clips') {
      // Helix treats a missing ended_at as started_at plus one week, so send both.
      const end = new Date();
      const start = new Date(end.getTime() - 30 * 864e5);
      const data = await helixApp<{ data?: HelixClip[]; pagination?: { cursor?: string } }>(
        'clips',
        (u) => {
          u.searchParams.set('broadcaster_id', id);
          u.searchParams.set('first', '20');
          u.searchParams.set('started_at', start.toISOString());
          u.searchParams.set('ended_at', end.toISOString());
          if (after) u.searchParams.set('after', after);
        },
        'Twitch clips',
      );
      page = {
        items: (data.data ?? []).filter((c) => c.id).map((c) => mapClip(c, name)),
        nextCursor: data.pagination?.cursor ?? null,
      };
    } else {
      const data = await helixApp<{ data?: HelixVideo[]; pagination?: { cursor?: string } }>(
        'videos',
        (u) => {
          u.searchParams.set('user_id', id);
          u.searchParams.set('type', type);
          u.searchParams.set('first', '20');
          if (after) u.searchParams.set('after', after);
        },
        'Twitch videos',
      );
      page = {
        items: (data.data ?? []).filter((v) => v.id).map((v) => mapVideo(v, name)),
        nextCursor: data.pagination?.cursor ?? null,
      };
    }
    videosCache.set(key, page);
    return reply.send(page);
  });

  // GET /api/twitch/categories?q=
  fastify.get<{ Querystring: { q?: string } }>('/categories', async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2 || q.length > 60) throw new HttpError(400, 'q must be 2 to 60 characters');
    const key = q.toLowerCase();
    const cached = categoriesCache.get(key);
    if (cached) return reply.send(cached);

    const data = await helixApp<{ data?: HelixCategory[] }>(
      'search/categories',
      (u) => {
        u.searchParams.set('query', q);
        u.searchParams.set('first', '8');
      },
      'Twitch categories',
    );
    const items = (data.data ?? []).filter((c) => c.id).map(mapCategory);
    categoriesCache.set(key, items);
    return reply.send(items);
  });

  // GET /api/twitch/top-games
  fastify.get('/top-games', async (_req, reply) => {
    const cached = topGamesCache.get('top');
    if (cached) return reply.send(cached);

    const data = await helixApp<{ data?: HelixCategory[] }>(
      'games/top',
      (u) => u.searchParams.set('first', '20'),
      'Twitch top games',
    );
    const items = (data.data ?? []).filter((c) => c.id).map(mapCategory);
    topGamesCache.set('top', items);
    return reply.send(items);
  });

  // GET /api/twitch/category-streams?gameId=&after= — live streams in a game.
  fastify.get<{ Querystring: { gameId?: string; after?: string } }>('/category-streams', async (req, reply) => {
    const gameId = req.query.gameId ?? '';
    if (!GAME_ID_RE.test(gameId)) throw new HttpError(400, 'Invalid gameId');
    const after = validCursor(req.query.after);

    const key = `${gameId}|${after ?? ''}`;
    const cached = categoryStreamsCache.get(key);
    if (cached) return reply.send(cached);

    const data = await helixApp<{ data?: HelixStream[]; pagination?: { cursor?: string } }>(
      'streams',
      (u) => {
        u.searchParams.set('game_id', gameId);
        u.searchParams.set('first', '20');
        if (after) u.searchParams.set('after', after);
      },
      'Twitch streams',
    );
    const page: TwitchSearchPage = {
      items: (data.data ?? []).filter((s) => s.user_login && (!s.type || s.type === 'live')).map(mapStream),
      nextCursor: data.pagination?.cursor ?? null,
    };
    categoryStreamsCache.set(key, page);
    return reply.send(page);
  });
};
