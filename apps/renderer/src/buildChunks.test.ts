/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the manualChunks split in vite.config.ts: markdown must stay a lazy chunk
// (loaded by the Claude/Notes widgets), never modulepreloaded from index.html.
// Runs after `pnpm build`; skipped on a fresh local checkout, but under CI a
// missing dist is a failure (CI builds before it tests).
const distDir = path.resolve(import.meta.dirname, '../dist');
const indexHtml = path.join(distDir, 'index.html');

const inCi = !!process.env.CI;

describe.skipIf(!inCi && !existsSync(indexHtml))('built index.html', () => {
  it.runIf(inCi)('has a build to check (CI builds before testing)', () => {
    expect(existsSync(indexHtml)).toBe(true);
  });

  it('does not modulepreload a chunk containing markdown libraries', () => {
    const html = readFileSync(indexHtml, 'utf8');
    const hrefs = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*>/g)]
      .map((m) => /href="([^"]+)"/.exec(m[0])?.[1])
      .filter((h): h is string => !!h);
    const offenders = hrefs.filter((href) => {
      const file = path.join(distDir, href);
      if (!existsSync(file)) return false;
      return /react-markdown|micromark/.test(readFileSync(file, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});
