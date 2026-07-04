import type { FastifyPluginAsync } from 'fastify';
import type { TwitchChannel, TwitchSearchPage, TwitchAuthStatus } from '@dash/shared';
import crypto from 'crypto';
import { fetchJson, HttpError, UpstreamError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';
import { UserTokenStore } from '../lib/userTokenStore';
import type { StoredUserTokens } from '../lib/userTokenStore';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const HELIX = 'https://api.twitch.tv/helix';

// ── User OAuth (authorization-code grant) ─────────────────────────────────────
// The client secret lives server-side, so no PKCE needed. This EXACT redirect
// URI must be registered in the Twitch dev console for the app.
const REDIRECT_URI = 'http://localhost:7432/api/twitch/callback';
const USER_SCOPES = 'user:read:follows';

async function refreshUserToken(refreshToken: string): Promise<StoredUserTokens> {
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

// 60s cache — followed-live status doesn't move faster, and the widget refetch
// on tab focus stays cheap.
const followedCache = new TtlCache<string, TwitchSearchPage>(60_000);

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
    return reply.code(204).send();
  });

  // GET /api/twitch/followed — live channels the connected user follows.
  fastify.get<{ Reply: TwitchSearchPage | { error: string } }>('/followed', async (_req, reply) => {
    // Not connected is an expected state (the Following tab shows Connect) —
    // 401, not 5xx, so the client poll doesn't read as a server failure.
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to Twitch' });

    const cached = followedCache.get('followed');
    if (cached) return reply.send(cached);

    const token = await userTokens.getValidToken();
    const userId = userTokens.meta?.userId;
    if (!userId) {
      userTokens.clear();
      return reply.code(401).send({ error: 'Twitch session incomplete — reconnect' });
    }

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
    return reply.send(page);
  });

  // GET /api/twitch/embed?channel=...
  // Serves a minimal HTML page wrapping the Twitch player. The parent origin
  // becomes http://localhost:7432, which matches the parent= param Twitch requires.
  fastify.get<{ Querystring: { channel: string } }>('/embed', async (req, reply) => {
    const { channel } = req.query;
    if (!channel || !/^[A-Za-z0-9_]{1,25}$/.test(channel)) {
      return reply.status(400).send('Invalid channel');
    }
    const src = `https://player.twitch.tv/?channel=${channel}&parent=localhost&autoplay=true`;
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
    const clientId = cred('TWITCH_CLIENT_ID');
    const clientSecret = cred('TWITCH_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new HttpError(503, 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not configured');
    }

    const { q, after } = req.query;
    if (!q?.trim()) throw new HttpError(400, 'q is required');

    const token = await getAppToken(clientId, clientSecret);

    const url = new URL(`${HELIX}/search/channels`);
    url.searchParams.set('query', q.trim());
    url.searchParams.set('first', '12');
    if (after) url.searchParams.set('after', after);

    let data: {
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
    };
    try {
      data = await fetchJson(
        url.toString(),
        { headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` } },
        { label: 'Twitch API' },
      );
    } catch (err) {
      // 401 → token rejected/expired; drop cache so the next call re-auths.
      if (err instanceof UpstreamError && err.status === 401) cachedToken = null;
      throw err;
    }

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
};
