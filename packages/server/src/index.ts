import { config } from 'dotenv';
import { resolve } from 'path';
import si from 'systeminformation';
import { buildServer } from './app';

// CWD is packages/server when run via Turborepo — walk up to monorepo root
config({ path: resolve(__dirname, '../../../.env') });

const port = Number(process.env.SERVER_PORT ?? 7432);

async function start(): Promise<void> {
  const server = await buildServer();

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
  console.error(err);
  process.exit(1);
});
