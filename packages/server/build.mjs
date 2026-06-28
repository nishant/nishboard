import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse root .env without pulling in dotenv as a build-time dep
const envFile = path.join(__dirname, '../../.env');
const envVars = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim();
  }
}

// Keys baked in at package time from .env.
// _BUILTIN vars are replaced with string literals by esbuild — they never
// appear in source or version control. Runtime env (from safeStorage/Settings)
// takes priority over these in every route.
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/index.js',
  define: {
    'process.env.SPOTIFY_CLIENT_ID_BUILTIN':    JSON.stringify(envVars.SPOTIFY_CLIENT_ID    ?? ''),
    'process.env.SPOTIFY_REDIRECT_URI_BUILTIN': JSON.stringify(envVars.SPOTIFY_REDIRECT_URI ?? 'http://localhost:7432/api/spotify/callback'),
    'process.env.YOUTUBE_API_KEY_BUILTIN':      JSON.stringify(envVars.YOUTUBE_API_KEY      ?? ''),
    'process.env.ALPACA_API_KEY_BUILTIN':       JSON.stringify(envVars.ALPACA_API_KEY       ?? ''),
    'process.env.ALPACA_API_SECRET_BUILTIN':    JSON.stringify(envVars.ALPACA_API_SECRET    ?? ''),
    'process.env.TWITCH_CLIENT_ID_BUILTIN':     JSON.stringify(envVars.TWITCH_CLIENT_ID     ?? ''),
    'process.env.TWITCH_CLIENT_SECRET_BUILTIN': JSON.stringify(envVars.TWITCH_CLIENT_SECRET ?? ''),
  },
});
