import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import { jsonRes, stubFetch } from '../test/fetchStub';

let home: string;
let app: FastifyInstance;

/** Fresh module graph per test: the token store reads ~/.dash at import, so
 *  point homedir at a temp dir first (never touch the real tokens). */
async function boot(connected: boolean): Promise<FastifyInstance> {
  vi.resetModules();
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  if (connected) {
    fs.mkdirSync(path.join(home, '.dash'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.dash', 'spotify_tokens.json'),
      JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3_600_000 }),
    );
  }
  const { testServer } = await import('../test/server');
  app = await testServer();
  return app;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-route-'));
});

afterEach(async () => {
  await app?.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('spotify routes', () => {
  it('returns 401 (not 502) when not connected', async () => {
    await boot(false);
    stubFetch([]);
    const res = await app.inject({ method: 'GET', url: '/api/spotify/devices' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a bad playlistId with 400', async () => {
    await boot(true);
    stubFetch([]);
    const res = await app.inject({ method: 'GET', url: '/api/spotify/playlist-tracks?playlistId=../me' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid /repeat state with 400', async () => {
    await boot(true);
    stubFetch([]);
    const res = await app.inject({ method: 'POST', url: '/api/spotify/repeat', payload: { state: 'bogus' } });
    expect(res.statusCode).toBe(400);
  });

  it('falls back to offset 0 when offset is NaN', async () => {
    await boot(true);
    const fetchMock = stubFetch([
      ['/me/playlists', () => jsonRes({ total: 0, offset: 0, limit: 20, items: [] })],
      ['/me/tracks', () => jsonRes({ total: 3 })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/spotify/playlists?offset=abc&limit=xyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ offset: number; limit: number }>()).toMatchObject({ offset: 0, limit: 20 });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/me/playlists?limit=20&offset=0'))).toBe(true);
  });
});
