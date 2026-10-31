import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { builtinKeys } from './lib/env';
import { weatherRoutes } from './routes/weather';
import { spotifyRoutes } from './routes/spotify';
import { stocksRoutes } from './routes/stocks';
import { hardwareRoutes } from './routes/hardware';
import { soundRoutes } from './routes/sound';
import { youtubeRoutes } from './routes/youtube';
import { calendarRoutes } from './routes/calendar';
import { twitchRoutes } from './routes/twitch';
import { newsRoutes } from './routes/news';
import { cryptoRoutes } from './routes/crypto';
import { claudeRoutes } from './routes/claude';
import { networkRoutes } from './routes/network';
import { discordRoutes } from './routes/discord';
import { inboxRoutes } from './routes/inbox';
import { HttpError, UpstreamError } from './lib/http';
import { ALLOWED_ORIGINS, registerAccessGuard } from './lib/access';

// Upstream statuses worth passing through — they tell the user something
// actionable (bad key, dev-mode allowlist, missing resource, rate limit).
// Anything else from an upstream is our 502.
const PASSTHROUGH_STATUSES = [401, 403, 404, 429];

/**
 * Build the fully-wired Fastify app: CORS, central error handler, every route
 * plugin, /health, and the builtin-credentials probe. No listen(), no dotenv,
 * no warmup — those are process concerns and live in index.ts, which keeps
 * this factory injectable for integration tests (`app.inject()`).
 *
 * `apiToken` is the per-launch bearer token the Electron main process minted
 * (env `DASH_API_TOKEN`); every request but /health, the embeds and the OAuth
 * callbacks must carry it (lib/access.ts). It is removed from process.env once
 * read, so the children this server spawns (the claude CLI, PowerShell) never
 * inherit it. `port` sets the allowed Host headers.
 */
export async function buildServer(
  opts: { logger?: boolean; apiToken?: string; port?: number } = {},
): Promise<FastifyInstance> {
  const apiToken = opts.apiToken ?? process.env.DASH_API_TOKEN;
  delete process.env.DASH_API_TOKEN;
  if (!apiToken) throw new Error('DASH_API_TOKEN must be set (the Electron main process passes it)');
  const port = opts.port ?? Number(process.env.SERVER_PORT ?? 7432);

  const server = Fastify({ logger: opts.logger === false ? false : { level: 'info' } });

  // Registered before the guard so a 401 or 403 still carries its CORS headers
  // and the renderer can read the error.
  // Authorization makes every request non-simple, so each one needs a
  // preflight; maxAge lets Chromium cache it instead of doubling every poll.
  await server.register(cors, { origin: [...ALLOWED_ORIGINS], maxAge: 600 });
  registerAccessGuard(server, { token: apiToken, port });

  // Central error handler — routes throw HttpError/UpstreamError (or let
  // fetchJson throw) instead of repeating try/catch → reply.code().send().
  server.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    if (err instanceof UpstreamError) {
      req.log.error(`[${req.routeOptions.url}] ${err.message}`);
      const status = PASSTHROUGH_STATUSES.includes(err.status) ? err.status : 502;
      return reply.code(status).send({ error: err.message });
    }
    // Fastify schema-validation errors (and other client errors) keep their status.
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }
    req.log.error(err);
    return reply.code(502).send({ error: err.message });
  });

  server.register(weatherRoutes, { prefix: '/api/weather' });
  server.register(spotifyRoutes, { prefix: '/api/spotify' });
  server.register(stocksRoutes, { prefix: '/api/stocks' });
  server.register(hardwareRoutes, { prefix: '/api/hardware' });
  server.register(soundRoutes, { prefix: '/api/sound' });
  server.register(youtubeRoutes, { prefix: '/api/youtube' });
  server.register(calendarRoutes, { prefix: '/api/calendar' });
  server.register(twitchRoutes, { prefix: '/api/twitch' });
  server.register(newsRoutes, { prefix: '/api/news' });
  server.register(cryptoRoutes, { prefix: '/api/crypto' });
  // NOTE: /api/claude/chat and /api/discord/stream hijack the reply for SSE —
  // they set Access-Control-Allow-Origin themselves from ALLOWED_ORIGINS.
  server.register(claudeRoutes, { prefix: '/api/claude' });
  server.register(networkRoutes, { prefix: '/api/network' });
  server.register(discordRoutes, { prefix: '/api/discord' });
  server.register(inboxRoutes, { prefix: '/api/inbox' });

  server.get('/health', async () => ({ status: 'ok' }));

  // Returns which credential keys are baked in at build time.
  // Only key names are returned — never values.
  server.get('/api/credentials/builtin', async () => ({
    keys: builtinKeys(),
  }));

  return server;
}
