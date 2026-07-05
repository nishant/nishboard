import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@dash/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
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
        // React internals (`__SECRET_INTERNALS…`) at module-init, and a recharts↔vendor
        // circular chunk left React uninitialized when recharts ran → blank screen in the
        // packaged build. A single vendor chunk lets Rollup order init topologically.
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
