import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { FastifyInstance } from 'fastify';
import type { YoutubeSearchPage } from '@dash/shared';
import { testServer } from '../test/server';
import { jsonRes, stubFetch } from '../test/fetchStub';
import { YoutubeSearchCache } from '../lib/youtubeSearchCache';
import { setSearchCacheForTests } from './youtube';

let app: FastifyInstance & { inject: FastifyInstance['inject'] };
let dir: string;

beforeAll(async () => {
  app = await testServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'test-key';
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-route-'));
  setSearchCacheForTests(new YoutubeSearchCache(path.join(dir, 'cache.json')));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.YOUTUBE_API_KEY;
  setSearchCacheForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

function stubYoutube(): ReturnType<typeof stubFetch> {
  return stubFetch([
    ['/youtube/v3/search', () =>
      jsonRes({
        nextPageToken: 'NEXT',
        items: [{
          id: { videoId: 'vid1' },
          snippet: {
            title: 'Foo &amp; bar',
            channelTitle: 'Chan',
            channelId: 'UCabc',
            thumbnails: { medium: { url: 'https://img/1.jpg' } },
            publishedAt: '2026-01-01T00:00:00Z',
            liveBroadcastContent: 'live',
          },
        }],
      })],
    ['/youtube/v3/videos', () =>
      jsonRes({ items: [{ id: 'vid1', contentDetails: { duration: 'P0D' }, snippet: { liveBroadcastContent: 'live' } }] })],
  ]);
}

const search = (qs: string) => app.inject({ method: 'GET', url: `/api/youtube/search?${qs}` });

describe('GET /api/youtube/search', () => {
  it('serves repeat searches from the saved page without calling YouTube', async () => {
    const fetchFn = stubYoutube();

    const first = await search('q=foo');
    expect(first.statusCode).toBe(200);
    const body = first.json<YoutubeSearchPage>();
    expect(body.cachedAt).toBeNull();
    expect(body.items[0]).toMatchObject({ videoId: 'vid1', title: 'Foo & bar', isLive: true, isShort: false });
    expect(fetchFn).toHaveBeenCalledTimes(2); // search + videos

    const second = await search('q=foo');
    expect(second.json<YoutubeSearchPage>().cachedAt).toEqual(expect.any(String));
    const third = await search('q=%20%20FOO%20');
    expect(third.json<YoutubeSearchPage>().cachedAt).toEqual(expect.any(String));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('refresh=1 and live=1 go upstream again; live adds eventType', async () => {
    const fetchFn = stubYoutube();
    await search('q=foo');
    await search('q=foo&refresh=1');
    expect(fetchFn).toHaveBeenCalledTimes(4);
    await search('q=foo&live=1');
    const searchUrls = fetchFn.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/search?'));
    expect(searchUrls).toHaveLength(3);
    expect(searchUrls[2]).toContain('eventType=live');
    expect(searchUrls[0]).not.toContain('eventType');
  });

  it('rejects bad parameters with 400', async () => {
    stubYoutube();
    expect((await search('q=foo&live=2')).statusCode).toBe(400);
    expect((await search('q=foo&refresh=0')).statusCode).toBe(400);
    expect((await search('q=%20%20')).statusCode).toBe(400);
    expect((await search(`q=${'a'.repeat(101)}`)).statusCode).toBe(400);
    expect((await search('q=foo&pageToken=bad%20token')).statusCode).toBe(400);
  });

  it('answers 503 without an API key', async () => {
    delete process.env.YOUTUBE_API_KEY;
    expect((await search('q=foo')).statusCode).toBe(503);
  });
});

describe('GET /api/youtube/search budget and staleness', () => {
  const left = () => {
    const file = path.join(dir, 'cache.json');
    return new YoutubeSearchCache(file).searchesLeft();
  };

  it('gives the search back when YouTube does not answer, but not on a 4xx', async () => {
    const full = left();
    stubFetch([['/youtube/v3/search', () => jsonRes({ error: 'boom' }, 503)]]);
    expect((await search('q=down')).statusCode).toBe(502);
    expect(left()).toBe(full);

    stubFetch([['/youtube/v3/search', () => jsonRes({ error: 'quota' }, 403)]]);
    expect((await search('q=quota')).statusCode).toBe(403);
    expect(left()).toBe(full - 1);
  });

  it('keeps and caches a paid search when the durations call fails (no refund)', async () => {
    const full = left();
    const fetchFn = stubFetch([
      ['/youtube/v3/search', () => jsonRes({
        items: [{
          id: { videoId: 'vidx' },
          snippet: {
            title: 'Clip #shorts',
            channelTitle: 'Chan',
            channelId: 'UCabc',
            thumbnails: { medium: { url: 'https://img/x.jpg' } },
            publishedAt: '2026-01-01T00:00:00Z',
          },
        }],
      })],
      ['/youtube/v3/videos', () => jsonRes({ error: 'unavailable' }, 503)],
    ]);
    const res = await search('q=nodur');
    expect(res.statusCode).toBe(200);
    expect(res.json<YoutubeSearchPage>().items[0]).toMatchObject({ videoId: 'vidx', durationSeconds: 0, isShort: true });
    expect(left()).toBe(full - 1); // the paid search is not refunded

    const calls = fetchFn.mock.calls.length;
    const again = await search('q=nodur');
    expect(again.statusCode).toBe(200);
    expect(again.json<YoutubeSearchPage>().cachedAt).not.toBeNull(); // cached
    expect(fetchFn.mock.calls.length).toBe(calls);
  });

  it('shares one upstream call between identical concurrent searches', async () => {
    const fetchFn = stubYoutube();
    const full = left();
    const [a, b] = await Promise.all([search('q=same'), search('q=same')]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2); // one search + one videos call
    expect(left()).toBe(full - 1);
  });

  it('drops live flags from a saved page older than the live TTL', async () => {
    stubYoutube();
    await search('q=launch');
    const later = Date.now() + 3 * 3_600_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    try {
      const saved = (await search('q=launch')).json<YoutubeSearchPage>();
      expect(saved.cachedAt).toEqual(expect.any(String));
      expect(saved.items[0].isLive).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
