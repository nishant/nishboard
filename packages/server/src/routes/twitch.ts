import type { FastifyPluginAsync } from 'fastify';
import type { TwitchChannel, TwitchSearchPage } from '@dash/shared';

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

  const res = await fetch(url.toString(), { method: 'POST' });
  if (!res.ok) throw new Error(`Twitch token error: ${res.status}`);

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

export const twitchRoutes: FastifyPluginAsync = async (fastify) => {
  const clientId = process.env.TWITCH_CLIENT_ID || process.env.TWITCH_CLIENT_ID_BUILTIN;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET || process.env.TWITCH_CLIENT_SECRET_BUILTIN;

  // GET /api/twitch/search?q=...&after=...
  fastify.get<{
    Querystring: { q: string; after?: string };
  }>('/search', async (req, reply) => {
    if (!clientId || !clientSecret) {
      return reply
        .status(503)
        .send({ error: 'TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not configured' });
    }

    const { q, after } = req.query;
    if (!q?.trim()) return reply.status(400).send({ error: 'q is required' });

    let token: string;
    try {
      token = await getAppToken(clientId, clientSecret);
    } catch (err) {
      req.log.error({ err }, 'Twitch token fetch failed');
      return reply.status(502).send({ error: 'Twitch auth error' });
    }

    const url = new URL(`${HELIX}/search/channels`);
    url.searchParams.set('query', q.trim());
    url.searchParams.set('first', '12');
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url.toString(), {
      headers: { 'Client-Id': clientId, Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      req.log.error({ status: res.status, body }, 'Twitch API error');
      // 401 → token rejected/expired; drop cache so the next call re-auths.
      if (res.status === 401) cachedToken = null;
      return reply.status(502).send({ error: 'Twitch API error' });
    }

    const data = (await res.json()) as {
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
