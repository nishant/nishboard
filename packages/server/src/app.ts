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
import { HttpError, UpstreamError } from './lib/http';

// Upstream statuses worth passing through — they tell the user something
// actionable (bad key, dev-mode allowlist, missing resource, rate limit).
// Anything else from an upstream is our 502.
const PASSTHROUGH_STATUSES = [401, 403, 404, 429];

/**
 * Build the fully-wired Fastify app: CORS, central error handler, every route
 * plugin, /health, and the builtin-credentials probe. No listen(), no dotenv,
 * no warmup — those are process concerns and live in index.ts, which keeps
 * this factory injectable for integration tests (`app.inject()`).
 */
export async function buildServer(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: opts.logger === false ? false : { level: 'info' } });

  // 'file://' is what Electron sends as the Origin from file:// pages today;
  // 'null' is what stock Chromium serializes — allow both so an Electron
  // upgrade can't silently break every packaged-app fetch.
  await server.register(cors, { origin: ['http://localhost:5173', 'file://', 'null'] });

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

  server.get('/health', async () => ({ status: 'ok' }));

  // Returns which credential keys are baked in at build time.
  // Only key names are returned — never values.
  server.get('/api/credentials/builtin', async () => ({
    keys: builtinKeys(),
  }));

  return server;
}
