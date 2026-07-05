import { defineConfig } from 'vitest/config';
import path from 'path';

// Aliases mirror vite.config.ts — tests resolve @dash/shared from source, so
// no shared build is needed to run them (turbo still orders ^build for cache
// correctness).
export default defineConfig({
  resolve: {
    alias: {
      '@dash/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
