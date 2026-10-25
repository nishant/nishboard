import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { PRESETS } from '@nish/ui/theme';
import { APP_PRESETS } from './src/lib/appPresets';
import { LEGACY_THEME_IDS } from './src/lib/legacyThemes';

const require = createRequire(import.meta.url);

/** Inlines @nish/ui's theme-init.js and Nishboard's own follow-up
 *  (src/theme-init-app.js) at the top of <head>, so the saved theme is on <html>
 *  before the first paint. Inline, not a file: the packaged app loads from
 *  file://, and a render-blocking inline script is the one thing that cannot
 *  arrive late. */
function themeInit(): Plugin {
  return {
    name: 'nishboard-theme-init',
    transformIndexHtml() {
      const schemes = JSON.stringify(Object.fromEntries(PRESETS.map((p) => [p.id, p.scheme])));
      // @nish/ui v0.1.0 ships `var THEMES = __THEMES__;` unreplaced (its build
      // replaced the first occurrence, in a comment), which throws before the
      // theme is applied. Fill it in here until the package is fixed.
      const shared = readFileSync(require.resolve('@nish/ui/theme-init.js'), 'utf8').replace(
        /var THEMES = __THEMES__;/,
        `var THEMES = ${schemes};`,
      );
      const app = readFileSync(path.resolve(import.meta.dirname, 'src/theme-init-app.js'), 'utf8')
        .replace('__NISH__', schemes)
        .replace('__APP__', JSON.stringify(Object.fromEntries(APP_PRESETS.map((p) => [p.id, p.base.scheme]))))
        .replace('__LEGACY__', JSON.stringify(LEGACY_THEME_IDS));
      return [{ tag: 'script', children: `${shared}\n${app}`, injectTo: 'head-prepend' }];
    },
  };
}

export default defineConfig({
  plugins: [themeInit(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@dash/shared': path.resolve(import.meta.dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    // 'hidden' keeps maps out of the bundle references (nothing ships pointing
    // at them) while still emitting them locally for debugging a prod build.
    // `true` inlined a 4MB map reference into the packaged app.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Keep node_modules in ONE vendor chunk (caches independently of app code).
        // Do NOT hand-split react/recharts into separate chunks: recharts reaches into
        // React internals at module-init, and a recharts↔vendor circular chunk left
        // React uninitialized when recharts ran → blank screen in the packaged build.
        // A single vendor chunk lets Rollup order init topologically.
        // grid-layout stays separate (leaf: depends on vendor one-way, never back).
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-grid-layout') || id.includes('react-resizable')) return 'grid-layout';
          return 'vendor';
        },
      },
    },
  },
  // Relative asset paths so file:// protocol works in the packaged Electron app.
  // Without this Vite emits src="/assets/..." which resolves to filesystem root, not the bundle.
  base: './',
});
