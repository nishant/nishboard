// Bundles the Electron main process and preload with esbuild (like the server):
// the packaged app has no node_modules, so electron-updater and @dash/shared
// must be inlined. `electron` is the only external.
//   node build.mjs          one-shot build
//   node build.mjs --watch  rebuild on change
//   node build.mjs --dev    build, start Electron, restart it after every rebuild
import * as esbuild from 'esbuild';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');
const dev = process.argv.includes('--dev');

/** @type {import('esbuild').BuildOptions} */
const options = {
  absWorkingDir: dir,
  entryPoints: { index: 'src/index.ts', preload: 'src/preload.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: false,
  logLevel: 'warning',
};

/** @type {import('child_process').ChildProcess | null} */
let child = null;

function startElectron() {
  const electronPath = require('electron');
  child = spawn(electronPath, ['.'], {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  });
  const started = child;
  started.on('exit', (code) => {
    // Exit with Electron when it ended on its own (not killed by a restart).
    if (child === started) process.exit(code ?? 0);
  });
}

function restartElectron() {
  const old = child;
  child = null;
  if (old && old.exitCode === null) {
    old.once('exit', startElectron);
    old.kill();
  } else {
    startElectron();
  }
}

if (dev) {
  let first = true;
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'restart-electron',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length > 0) return;
            if (first) {
              first = false;
              startElectron();
            } else {
              restartElectron();
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  const stop = () => {
    const c = child;
    child = null;
    c?.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
