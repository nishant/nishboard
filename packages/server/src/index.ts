import { config } from 'dotenv';
import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path, { resolve } from 'path';
import si from 'systeminformation';
import { buildServer } from './app';

// CWD is packages/server when run via Turborepo — walk up to monorepo root
config({ path: resolve(__dirname, '../../../.env') });

const port = Number(process.env.SERVER_PORT ?? 7432);

/** `pnpm dev` starts this server through concurrently, not from Electron main,
 *  so the two meet at a token file instead of an env var. Whichever starts
 *  first creates it (`wx`); the other reads it. apps/main/src/apiToken.ts holds
 *  the other half. Production never reads it: main always passes the env var. */
function devApiToken(): string {
  const file = path.join(os.homedir(), '.dash', 'dev-api-token');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'EEXIST')) throw err;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

async function start(): Promise<void> {
  const apiToken = process.env.DASH_API_TOKEN
    ?? (process.env.NODE_ENV === 'production' ? undefined : devApiToken());
  const server = await buildServer({ apiToken, port });

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
