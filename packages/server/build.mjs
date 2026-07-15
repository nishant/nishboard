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

// Keys baked in at package time from .env, injected as ONE static define:
// esbuild replaces the literal `process.env.BUILTINS_JSON` reference in
// lib/env.ts with a JSON string of this map. (Per-key `<KEY>_BUILTIN` defines
// can't work — cred() accesses process.env dynamically, and define only
// rewrites static member expressions.) Values land in the compiled bundle
// only — never in source or git.
const BUILTIN_KEYS = [
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_REDIRECT_URI',
  'YOUTUBE_API_KEY',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
  'ALPACA_API_KEY',
  'ALPACA_API_SECRET',
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'COINGECKO_API_KEY',
];
const builtins = Object.fromEntries(
  BUILTIN_KEYS.map((k) => [k, envVars[k] ?? '']).filter(([, v]) => v !== ''),
);

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/index.js',
  define: {
    // Double-stringify: the define value must be a JS expression — here, a
    // string literal whose contents are the JSON map.
    'process.env.BUILTINS_JSON': JSON.stringify(JSON.stringify(builtins)),
  },
});
