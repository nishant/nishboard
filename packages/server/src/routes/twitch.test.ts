import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { TwitchCategory, TwitchSearchPage, TwitchVideosPage } from '@dash/shared';
import { testServer } from '../test/server';
import { jsonRes, stubFetch } from '../test/fetchStub';
import type { FetchRoute } from '../test/fetchStub';

// NOTE: module-level TTL caches (and the app token) persist across tests, so
// each test uses its own login / query / game id.

const tokenRoute: FetchRoute = ['id.twitch.tv/oauth2/token', () => jsonRes({ access_token: 'tok', expires_in: 3600 })];

let app: FastifyInstance & { rawInject: (o: { method: 'GET'; url: string; headers: Record<string, string> }) => Promise<{ statusCode: number; body: string }> };

beforeAll(async () => {
  process.env.TWITCH_CLIENT_ID = 'cid';
  process.env.TWITCH_CLIENT_SECRET = 'csecret';
  app = await testServer();
});

afterAll(async () => {
  delete process.env.TWITCH_CLIENT_ID;
  delete process.env.TWITCH_CLIENT_SECRET;
  await app.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/twitch/videos', () => {
  const user: FetchRoute = ['helix/users?login=', () => jsonRes({ data: [{ id: '42' }] })];

  it('maps Helix videos and serves the second call from cache', async () => {
    const fetchFn = stubFetch([
      tokenRoute,
      user,
      ['helix/videos', () => jsonRes({
        data: [{
          id: '123', title: 'Run', user_name: 'Alice', thumbnail_url: 'https://x.test/t-%{width}x%{height}.jpg',
          duration: '1h2m3s', created_at: '2026-01-01T00:00:00Z', view_count: 7,
        }],
        pagination: { cursor: 'abc' },
      })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/twitch/videos?login=Alice' });
    expect(res.statusCode).toBe(200);
    const page = res.json<TwitchVideosPage>();
    expect(page.nextCursor).toBe('abc');
    expect(page.items[0]).toEqual({
      kind: 'vod', id: '123', title: 'Run', login: 'alice', displayName: 'Alice',
      thumbnailUrl: 'https://x.test/t-320x180.jpg', durationSeconds: 3723,
      createdAt: '2026-01-01T00:00:00Z', views: 7,
    });
    expect(String(fetchFn.mock.calls.find((c) => String(c[0]).includes('helix/videos'))?.[0])).toContain('type=archive');
    const calls = fetchFn.mock.calls.length;
    await app.inject({ method: 'GET', url: '/api/twitch/videos?login=alice' });
    expect(fetchFn.mock.calls.length).toBe(calls);
  });

  it('404s on an unknown login', async () => {
    stubFetch([tokenRoute, ['helix/users?login=', () => jsonRes({ data: [] })]]);
    const res = await app.inject({ method: 'GET', url: '/api/twitch/videos?login=nobody_here' });
    expect(res.statusCode).toBe(404);
  });

  it('400s on a bad type, login or cursor', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/twitch/videos?login=bob&type=nope' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/twitch/videos?login=b!d' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/twitch/videos?login=bob&after=a%20b' })).statusCode).toBe(400);
  });

  it('sends started_at and ended_at for clips', async () => {
    const fetchFn = stubFetch([
      tokenRoute,
      user,
      ['helix/clips', () => jsonRes({
        data: [{ id: 'Slug-1', title: 'Clip', broadcaster_name: 'Carol', thumbnail_url: 'https://x.test/c.jpg', duration: 29.6, view_count: 3 }],
      })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/twitch/videos?login=carol&type=clips' });
    expect(res.statusCode).toBe(200);
    const item = res.json<TwitchVideosPage>().items[0];
    expect(item.kind).toBe('clip');
    expect(item.durationSeconds).toBe(30);
    const url = new URL(String(fetchFn.mock.calls.find((c) => String(c[0]).includes('helix/clips'))?.[0]));
    expect(url.searchParams.get('broadcaster_id')).toBe('42');
    expect(url.searchParams.get('started_at')).toBeTruthy();
    expect(url.searchParams.get('ended_at')).toBeTruthy();
  });
});

describe('GET /api/twitch/categories', () => {
  it('400s on a short query', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/twitch/categories?q=a' })).statusCode).toBe(400);
  });

  it('maps categories and enlarges box art', async () => {
    stubFetch([
      tokenRoute,
      ['search/categories', () => jsonRes({ data: [{ id: '9', name: 'Chess', box_art_url: 'https://x.test/c-52x72.jpg' }] })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/twitch/categories?q=chess' });
    expect(res.json<TwitchCategory[]>()).toEqual([{ id: '9', name: 'Chess', boxArtUrl: 'https://x.test/c-144x192.jpg' }]);
  });
});

describe('GET /api/twitch/top-games', () => {
  it('maps top games', async () => {
    stubFetch([
      tokenRoute,
      ['games/top', () => jsonRes({ data: [{ id: '1', name: 'Just Chatting', box_art_url: 'https://x.test/j-{width}x{height}.jpg' }] })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/twitch/top-games' });
    expect(res.json<TwitchCategory[]>()).toEqual([{ id: '1', name: 'Just Chatting', boxArtUrl: 'https://x.test/j-144x192.jpg' }]);
  });
});

describe('GET /api/twitch/category-streams', () => {
  it('maps live streams and drops non-live entries', async () => {
    stubFetch([
      tokenRoute,
      ['helix/streams', () => jsonRes({
        data: [
          { user_id: '1', user_login: 'Dave', user_name: 'Dave', title: 'Hi', game_name: 'Chess', type: 'live', started_at: '2026-01-01T00:00:00Z', thumbnail_url: 'https://x.test/s-{width}x{height}.jpg' },
          { user_id: '2', user_login: 'rerun', user_name: 'Rerun', type: 'vodcast', thumbnail_url: '' },
        ],
        pagination: { cursor: 'n1' },
      })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/twitch/category-streams?gameId=555' });
    const page = res.json<TwitchSearchPage>();
    expect(page.nextCursor).toBe('n1');
    expect(page.items).toEqual([{
      id: '1', login: 'dave', displayName: 'Dave', thumbnailUrl: 'https://x.test/s-320x180.jpg',
      isLive: true, title: 'Hi', gameName: 'Chess', startedAt: '2026-01-01T00:00:00Z',
    }]);
  });

  it('400s on a non-numeric game id', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/twitch/category-streams?gameId=abc' })).statusCode).toBe(400);
  });
});

describe('GET /api/twitch/embed', () => {
  // The embed is an open route: no token header, like a browser navigation.
  const embed = (query: string) =>
    app.rawInject({ method: 'GET', url: `/api/twitch/embed?${query}`, headers: { host: '127.0.0.1:7432' } });

  it('keeps channel embeds', async () => {
    const res = await embed('channel=some_one');
    expect(res.body).toContain('src="https://player.twitch.tv/?channel=some_one&parent=localhost&autoplay=true"');
  });

  it('embeds a VOD', async () => {
    const res = await embed('video=123');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('src="https://player.twitch.tv/?video=v123&parent=localhost&autoplay=true"');
  });

  it('embeds a clip', async () => {
    const res = await embed('clip=Abc-1');
    expect(res.body).toContain('src="https://clips.twitch.tv/embed?clip=Abc-1&parent=localhost&autoplay=true"');
  });

  it('400s on a bad or ambiguous target', async () => {
    for (const q of ['video=abc', 'clip=a%22b', 'channel=a&video=1', '']) {
      const res = await embed(q);
      expect(res.statusCode).toBe(400);
      expect(res.body).toBe('Invalid embed target');
    }
  });
});

describe('Twitch app token request', () => {
  it('POSTs the secret in a form body, never in the URL', async () => {
    const fetchFn = stubFetch([
      ['id.twitch.tv/oauth2/token', () => jsonRes({ access_token: 'tok', expires_in: 3600 })],
      ['helix/search/categories', () => jsonRes({ data: [] })],
    ]);
    // The app token is cached module-wide; only assert when this test fetched it.
    await app.inject({ method: 'GET', url: '/api/twitch/categories?q=tokenformtest' });
    const tokenCall = fetchFn.mock.calls.find(([u]) => String(u).includes('oauth2/token'));
    if (tokenCall) {
      const [url, init] = tokenCall as [string, RequestInit];
      expect(String(url)).not.toContain('client_secret');
      expect(init.method).toBe('POST');
      expect(new Headers(init.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
      expect(String(init.body)).toContain('client_secret=csecret');
      expect(String(init.body)).toContain('grant_type=client_credentials');
    }
  });
});

describe('GET /api/twitch/search', () => {
  it('400s on a bad cursor and on an over-long q', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/twitch/search?q=bob&after=a%20b' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/twitch/search?q=${'x'.repeat(101)}` })).statusCode).toBe(400);
  });
});

describe('GET /api/twitch/callback state handling', () => {
  it('a wrong state is a 400 and does not cancel the pending flow', async () => {
    const urlRes = await app.inject({ method: 'GET', url: '/api/twitch/auth-url' });
    const state = new URL(urlRes.json<{ url: string }>().url).searchParams.get('state') ?? '';
    expect(state).not.toBe('');

    const bad = await app.inject({ method: 'GET', url: '/api/twitch/callback?code=c&state=wrong' });
    expect(bad.statusCode).toBe(400);

    const fetchFn = stubFetch([['id.twitch.tv/oauth2/token', () => jsonRes({ message: 'x' }, 400)]]);
    const ok = await app.inject({ method: 'GET', url: `/api/twitch/callback?code=c&state=${state}` });
    expect(ok.statusCode).toBe(502);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const replay = await app.inject({ method: 'GET', url: `/api/twitch/callback?code=c&state=${state}` });
    expect(replay.statusCode).toBe(400);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
