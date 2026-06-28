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

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/index.js',
  define: {
    // Baked in at package time from .env — never appears in source.
    // Runtime values from safeStorage/Settings take priority.
    'process.env.SPOTIFY_CLIENT_ID_BUILTIN': JSON.stringify(envVars.SPOTIFY_CLIENT_ID ?? ''),
    'process.env.SPOTIFY_REDIRECT_URI_BUILTIN': JSON.stringify(envVars.SPOTIFY_REDIRECT_URI ?? 'http://localhost:7432/api/spotify/callback'),
  },
});
