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
        // Split the heavyweights so the initial parse/execute on cold start is
        // smaller and vendor code caches independently of app code.
        manualChunks: {
          recharts: ['recharts'],
          'grid-layout': ['react-grid-layout'],
          vendor: ['react', 'react-dom', '@tanstack/react-query', 'lucide-react'],
        },
      },
    },
  },
  // Relative asset paths so file:// protocol works in the packaged Electron app.
  // Without this Vite emits src="/assets/..." which resolves to filesystem root, not the bundle.
  base: './',
});
