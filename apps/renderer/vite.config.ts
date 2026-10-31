import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { APP_PRESETS } from './src/lib/appPresets.ts';
import { LEGACY_THEME_IDS } from './src/lib/legacyThemes.ts';
import { buildCsp } from './src/csp.ts';

const require = createRequire(import.meta.url);

/** Inlines Nishboard's prelude (src/theme-init-app.js: app-local theme ids on
 *  window.__nishExtraThemes, the saved choice, Custom colors) and then @nish/ui's
 *  theme-init.js at the top of <head>, so the saved theme is on <html> before the
 *  first paint. Inline, not a file: the packaged app loads from file://, and a
 *  render-blocking inline script is the one thing that cannot arrive late. */
function themeInit(): Plugin {
  return {
    name: 'nishboard-theme-init',
    transformIndexHtml() {
      const app = readFileSync(path.resolve(import.meta.dirname, 'src/theme-init-app.js'), 'utf8')
        .replace('__APP__', JSON.stringify(Object.fromEntries(APP_PRESETS.map((p) => [p.id, p.base.scheme]))))
        .replace('__LEGACY__', JSON.stringify(LEGACY_THEME_IDS));
      const shared = readFileSync(require.resolve('@nish/ui/theme-init.js'), 'utf8');
      return [{ tag: 'script', children: `${app}\n${shared}`.replace(/\r\n?/g, '\n'), injectTo: 'head-prepend' }];
    },
  };
}

/** Injects a Content-Security-Policy <meta> as the first child of <head> in production
 *  builds. Every inline <script> in the final HTML is allowed by SHA-256 hash. A meta CSP
 *  only governs content after it, hence head-prepend and a post-order hook that runs after
 *  themeInit() has added its inline script. */
function csp(): Plugin {
  return {
    name: 'nishboard-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline: string[] = [];
        for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
          if (!/\bsrc\s*=/i.test(m[1] ?? '')) inline.push((m[2] ?? '').replace(/\r\n?/g, '\n'));
        }
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: buildCsp(inline) },
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

/** react-markdown / remark-gfm and their unified-ecosystem dependencies (Claude, Notes). */
const MARKDOWN_PKG =
  /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:react-markdown|remark-[^\\/]+|micromark[^\\/]*|mdast-[^\\/]+|unified)[\\/]/;

export default defineConfig({
  plugins: [themeInit(), csp(), react(), tailwindcss()],
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
    // No source maps: none are emitted, so none can ship in the installer.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Keep node_modules in ONE vendor chunk (caches independently of app code).
        // Do NOT hand-split react out of its consumers: a circular chunk leaves React
        // uninitialized at module-init → blank screen in the packaged build.
        // grid-layout stays a separate chunk; react-markdown/remark-gfm are left to the
        // bundler so they stay lazy with the Claude and Notes widgets.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-grid-layout') || id.includes('react-resizable')) return 'grid-layout';
          // No named chunk: markdown follows its lazy importers (Claude, Notes), so it is
          // not preloaded at startup. A named group pulls shared deps (react/jsx-runtime)
          // into it and makes vendor depend on it.
          if (MARKDOWN_PKG.test(id)) return;
          return 'vendor';
        },
      },
    },
  },
  // Relative asset paths so file:// protocol works in the packaged Electron app.
  // Without this Vite emits src="/assets/..." which resolves to filesystem root, not the bundle.
  base: './',
});
