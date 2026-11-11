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

  it('rejects a bad /seek, /shuffle and /volume body with 400 and no upstream call', async () => {
    await boot(true);
    const fetchMock = stubFetch([]);
    for (const [url, payload] of [
      ['seek', { positionMs: 'x' }], ['seek', { positionMs: -1 }], ['shuffle', { state: 'track&device_id=x' }],
      ['volume', { volumePercent: 101 }], ['volume', {}],
    ] as const) {
      const res = await app.inject({ method: 'POST', url: `/api/spotify/${url}`, payload });
      expect(res.statusCode).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('/play with no device anywhere returns a non-2xx', async () => {
    await boot(true);
    stubFetch([
      ['/me/player/devices', () => jsonRes({ devices: [] })],
      ['/me/player/play', () => jsonRes({ error: 'no device' }, 404)],
    ]);
    const res = await app.inject({ method: 'POST', url: '/api/spotify/play' });
    expect(res.statusCode).toBe(404);
  });

  it('keys the track page cache by limit', async () => {
    await boot(true);
    const fetchMock = stubFetch([['/me/tracks', () => jsonRes({ total: 0, offset: 0, limit: 50, items: [] })]]);
    await app.inject({ method: 'GET', url: '/api/spotify/playlist-tracks?playlistId=liked-songs&limit=10' });
    const res = await app.inject({ method: 'GET', url: '/api/spotify/playlist-tracks?playlistId=liked-songs&limit=20' });
    expect(res.json<{ limit: number }>().limit).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a wrong callback state is a 400 with no token exchange, and error=<script> is escaped', async () => {
    await boot(false);
    const fetchMock = stubFetch([]);
    const urlRes = await app.inject({ method: 'GET', url: '/api/spotify/auth-url' });
    expect(urlRes.statusCode).toBe(200);
    const bad = await app.inject({ method: 'GET', url: '/api/spotify/callback?code=c&state=wrong' });
    expect(bad.statusCode).toBe(400);
    const err = await app.inject({ method: 'GET', url: '/api/spotify/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E' });
    expect(err.body).not.toContain('<script>');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
