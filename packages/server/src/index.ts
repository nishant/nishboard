import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from 'dotenv';
import { resolve } from 'path';
import si from 'systeminformation';
import { weatherRoutes } from './routes/weather';
import { spotifyRoutes } from './routes/spotify';
import { stocksRoutes } from './routes/stocks';
import { hardwareRoutes } from './routes/hardware';
import { soundRoutes } from './routes/sound';
import { youtubeRoutes } from './routes/youtube';
import { twitchRoutes } from './routes/twitch';
import { newsRoutes } from './routes/news';

// CWD is packages/server when run via Turborepo — walk up to monorepo root
config({ path: resolve(__dirname, '../../../.env') });

const server = Fastify({ logger: { level: 'info' } });

const port = Number(process.env.SERVER_PORT ?? 7432);

async function start(): Promise<void> {
  await server.register(cors, { origin: ['http://localhost:5173', 'file://'] });

  server.register(weatherRoutes, { prefix: '/api/weather' });
  server.register(spotifyRoutes, { prefix: '/api/spotify' });
  server.register(stocksRoutes, { prefix: '/api/stocks' });
  server.register(hardwareRoutes, { prefix: '/api/hardware' });
  server.register(soundRoutes, { prefix: '/api/sound' });
  server.register(youtubeRoutes, { prefix: '/api/youtube' });
  server.register(twitchRoutes, { prefix: '/api/twitch' });
  server.register(newsRoutes, { prefix: '/api/news' });

  server.get('/health', async () => ({ status: 'ok' }));

  // Returns which credential keys are baked in at build time.
  // Only key names are returned — never values.
  server.get('/api/credentials/builtin', async () => ({
    keys: [
      process.env.SPOTIFY_CLIENT_ID_BUILTIN    && 'SPOTIFY_CLIENT_ID',
      process.env.YOUTUBE_API_KEY_BUILTIN      && 'YOUTUBE_API_KEY',
      process.env.ALPACA_API_KEY_BUILTIN       && 'ALPACA_API_KEY',
      process.env.ALPACA_API_SECRET_BUILTIN    && 'ALPACA_API_SECRET',
      process.env.TWITCH_CLIENT_ID_BUILTIN     && 'TWITCH_CLIENT_ID',
      process.env.TWITCH_CLIENT_SECRET_BUILTIN && 'TWITCH_CLIENT_SECRET',
    ].filter(Boolean),
  }));

  await server.listen({ port, host: '127.0.0.1' });

  // Warm up slow OS APIs in the background so the first renderer request is fast.
  // si.currentLoad() needs a ~1s CPU delta sample; si.graphics() calls system_profiler
  // (cold: 3-5s). Fire-and-forget — failures are non-fatal.
  Promise.allSettled([
    si.currentLoad(),
    si.graphics(),
    si.cpuTemperature(),
    // Prime osascript on macOS so the sound route doesn't cold-start on first request
    ...(process.platform === 'darwin'
      ? [import('child_process').then(({ exec }) =>
          new Promise<void>((res) => exec("osascript -e 'output volume of (get volume settings)'", () => res()))
        )]
      : []),
  ]).then(() => server.log.info('[warmup] done'));
}

start().catch((err) => {
  server.log.error(err);
  process.exit(1);
});
