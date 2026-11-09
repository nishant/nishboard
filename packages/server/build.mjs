import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse root .env with dotenv's own parser, so the packaged app sees exactly
// what dev sees (quotes stripped, inline comments removed, `export KEY=` and
// CRLF handled). A hand-rolled parser once baked ZERO keys from a CRLF .env.
const envFile = path.join(__dirname, '../../.env');
const envVars = fs.existsSync(envFile) ? parse(fs.readFileSync(envFile)) : {};

// Keys baked in at package time from .env, injected as ONE static define:
// esbuild replaces the literal `process.env.BUILTINS_JSON` reference in
// lib/env.ts with a JSON string of this map. (Per-key `<KEY>_BUILTIN` defines
// can't work — cred() accesses process.env dynamically, and define only
// rewrites static member expressions.) Values land in the compiled bundle
// only — never in source or git. Trading-capable keys (ALPACA_*) are NOT
// baked: they come from Settings → Developer (safeStorage) only.
const BUILTIN_KEYS = [
  'SPOTIFY_CLIENT_ID',
  'SPOTIFY_REDIRECT_URI',
  'YOUTUBE_API_KEY',
  'YOUTUBE_CLIENT_ID',
  'YOUTUBE_CLIENT_SECRET',
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
