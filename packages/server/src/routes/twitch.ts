import type { FastifyPluginAsync } from 'fastify';
import type { TwitchChannel, TwitchSearchPage } from '@dash/shared';
import { fetchJson, HttpError, UpstreamError } from '../lib/http';
import { cred } from '../lib/env';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const HELIX = 'https://api.twitch.tv/helix';

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

export const twitchRoutes: FastifyPluginAsync = async (fastify) => {

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
