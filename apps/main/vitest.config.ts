import { defineConfig } from 'vitest/config';
import path from 'path';

// Main-process modules import `electron` at module scope; the alias swaps in a
// stub so their pure logic (launcher migration, update parsing) runs in plain
// node — same trick as bundler-based smoke tests, but resolved by vitest.
export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'test/electron-stub.ts'),
      '@dash/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
