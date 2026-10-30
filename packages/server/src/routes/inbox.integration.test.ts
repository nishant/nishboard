import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../app';
import { resetInboxSession } from '../lib/inboxClient';
import { jsonRes, stubFetch, type FetchRoute } from '../test/fetchStub';

const LIST = {
  items: [],
  nextCursor: null,
  counts: { open: 0, snoozed: 0, handled: 0, urgent: 0 },
  sources: [],
};

function loginOk(token = 'tok1'): Response {
  return new Response(null, { status: 204, headers: { 'set-cookie': `inbox_session=${token}; Path=/; HttpOnly` } });
}

function callsTo(fn: ReturnType<typeof stubFetch>, part: string): Array<[string, RequestInit]> {
  return (fn.mock.calls as Array<[string, RequestInit]>).filter(([u]) => String(u).includes(part));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ logger: false });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  process.env.INBOX_PASSWORD = 'hunter2';
  resetInboxSession();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.INBOX_PASSWORD;
});

describe('GET /api/inbox/items', () => {
  it('returns no-password without any fetch', async () => {
    delete process.env.INBOX_PASSWORD;
    const fn = stubFetch([]);
    const res = await app.inject({ method: 'GET', url: '/api/inbox/items' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'no-password' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns offline (200) when the inbox is unreachable', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fn);
    const res = await app.inject({ method: 'GET', url: '/api/inbox/items' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'offline' });
  });

  it('returns bad-password when the login answers 401', async () => {
    stubFetch([['/api/login', () => jsonRes({ error: 'Wrong password.' }, 401)]]);
    const res = await app.inject({ method: 'GET', url: '/api/inbox/items' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: 'bad-password' });
  });

  it('logs in, sends the cookie and no origin, and returns the list', async () => {
    const fn = stubFetch([
      ['/api/login', () => loginOk('abc')],
      ['/api/items', () => jsonRes(LIST)],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/inbox/items?view=snoozed&source=my-app&limit=20' });
    expect(res.json()).toEqual({ state: 'ok', list: LIST });
    const [url, init] = callsTo(fn, '/api/items')[0];
    expect(url).toContain('view=snoozed');
    expect(url).toContain('source=my-app');
    expect(url).toContain('limit=20');
    const headers = init.headers as Record<string, string>;
    expect(headers.cookie).toBe('inbox_session=abc');
    for (const [, i] of fn.mock.calls as Array<[string, RequestInit]>) {
      const h = Object.keys((i.headers ?? {}) as Record<string, string>).map((k) => k.toLowerCase());
      expect(h).not.toContain('origin');
    }
    expect(fn.mock.calls.every(([u]) => !String(u).includes('/ingest'))).toBe(true);
    const login = callsTo(fn, '/api/login')[0][1];
    expect(login.body).toBe(JSON.stringify({ password: 'hunter2' }));
  });

  it('re-logs in once and retries when the cached cookie is rejected', async () => {
    let itemCalls = 0;
    let logins = 0;
    const routes: FetchRoute[] = [
      ['/api/login', () => loginOk(`tok${++logins}`)],
      ['/api/items', () => (++itemCalls === 1 ? jsonRes({ error: 'no' }, 401) : jsonRes(LIST))],
    ];
    stubFetch(routes);
    const res = await app.inject({ method: 'GET', url: '/api/inbox/items' });
    expect(res.json()).toEqual({ state: 'ok', list: LIST });
    expect(logins).toBe(2);
    expect(itemCalls).toBe(2);
  });

  it('gives up with bad-password after a second 401 (no login loop)', async () => {
    let logins = 0;
    const fn = stubFetch([
      ['/api/login', () => loginOk(`tok${++logins}`)],
      ['/api/items', () => jsonRes({ error: 'no' }, 401)],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/inbox/items' });
    expect(res.json()).toEqual({ state: 'bad-password' });
    expect(callsTo(fn, '/api/login')).toHaveLength(2);
    expect(callsTo(fn, '/api/items')).toHaveLength(2);
  });

  it('shares one login between concurrent first requests', async () => {
    const fn = stubFetch([
      ['/api/login', () => loginOk()],
      ['/api/items', () => jsonRes(LIST)],
    ]);
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/inbox/items' }),
      app.inject({ method: 'GET', url: '/api/inbox/items?view=handled' }),
    ]);
    expect(a.json().state).toBe('ok');
    expect(b.json().state).toBe('ok');
    expect(callsTo(fn, '/api/login')).toHaveLength(1);
  });

  it('400s on bad view, source, cursor and limit without calling upstream', async () => {
    const fn = stubFetch([]);
    for (const q of ['view=nope', 'source=Bad!', 'cursor=a%20b', 'limit=0', 'limit=101']) {
      const res = await app.inject({ method: 'GET', url: `/api/inbox/items?${q}` });
      expect(res.statusCode).toBe(400);
    }
    expect((await app.inject({ method: 'GET', url: '/api/inbox/items?view=nope' })).json().error).toBe('Bad view.');
    expect(fn).not.toHaveBeenCalled();
  });

  it('maps an inbox 5xx to 502 with its message', async () => {
    stubFetch([
      ['/api/login', () => loginOk()],
      ['/api/items', () => jsonRes({ error: 'db down' }, 500)],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/inbox/items' });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe('db down');
  });
});

describe('POST /api/inbox/items/...', () => {
  it('proxies handle with a JSON body', async () => {
    const fn = stubFetch([
      ['/api/login', () => loginOk()],
      ['/items/7/handle', () => jsonRes({ id: 7 })],
    ]);
    const res = await app.inject({ method: 'POST', url: '/api/inbox/items/7/handle', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 7 });
    const [, init] = callsTo(fn, '/items/7/handle')[0];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{}');
  });

  it('proxies unhandle and unsnooze', async () => {
    stubFetch([
      ['/api/login', () => loginOk()],
      ['/items/7/unhandle', () => jsonRes({ id: 7, handledAt: null })],
      ['/items/7/unsnooze', () => jsonRes({ id: 7, snoozedUntil: null })],
    ]);
    expect((await app.inject({ method: 'POST', url: '/api/inbox/items/7/unhandle', payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/inbox/items/7/unsnooze', payload: {} })).statusCode).toBe(200);
  });

  it('proxies snooze with { until }', async () => {
    const fn = stubFetch([
      ['/api/login', () => loginOk()],
      ['/items/3/snooze', () => jsonRes({ id: 3 })],
    ]);
    const until = '2026-11-01T08:00:00.000Z';
    const res = await app.inject({ method: 'POST', url: '/api/inbox/items/3/snooze', payload: { until } });
    expect(res.statusCode).toBe(200);
    expect(callsTo(fn, '/items/3/snooze')[0][1].body).toBe(JSON.stringify({ until }));
  });

  it('400s a bad snooze time without calling upstream', async () => {
    const fn = stubFetch([]);
    for (const payload of [{ until: 'garbage' }, {}, { until: 5 }]) {
      const res = await app.inject({ method: 'POST', url: '/api/inbox/items/3/snooze', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Pick a snooze time.');
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('404s a non-numeric id without calling upstream', async () => {
    const fn = stubFetch([]);
    for (const verb of ['handle', 'unhandle', 'snooze', 'unsnooze']) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/inbox/items/abc/${verb}`,
        payload: { until: '2026-11-01T08:00:00.000Z' },
      });
      expect(res.statusCode).toBe(404);
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('passes an inbox 409 through with its message', async () => {
    stubFetch([
      ['/api/login', () => loginOk()],
      ['/items/9/handle', () => jsonRes({ error: 'This item is already handled.' }, 409)],
    ]);
    const res = await app.inject({ method: 'POST', url: '/api/inbox/items/9/handle', payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('This item is already handled.');
  });

  it('handle-all proxies { source } or {} and returns the count', async () => {
    const fn = stubFetch([
      ['/api/login', () => loginOk()],
      ['/items/handle-all', () => jsonRes({ count: 4 })],
    ]);
    const a = await app.inject({ method: 'POST', url: '/api/inbox/items/handle-all', payload: { source: 'my-app' } });
    expect(a.json()).toEqual({ count: 4 });
    const b = await app.inject({ method: 'POST', url: '/api/inbox/items/handle-all', payload: {} });
    expect(b.statusCode).toBe(200);
    const calls = callsTo(fn, '/items/handle-all');
    expect(calls[0][1].body).toBe(JSON.stringify({ source: 'my-app' }));
    expect(calls[1][1].body).toBe('{}');
    const bad = await app.inject({ method: 'POST', url: '/api/inbox/items/handle-all', payload: { source: 'No Good' } });
    expect(bad.statusCode).toBe(400);
  });

  it('maps offline, no-password and bad-password on mutations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const off = await app.inject({ method: 'POST', url: '/api/inbox/items/1/handle', payload: {} });
    expect(off.statusCode).toBe(503);
    expect(off.json().error).toBe('Inbox is not reachable.');

    delete process.env.INBOX_PASSWORD;
    const np = await app.inject({ method: 'POST', url: '/api/inbox/items/1/handle', payload: {} });
    expect(np.statusCode).toBe(400);
    expect(np.json().error).toBe('Add the Inbox password in Settings → Developer.');

    process.env.INBOX_PASSWORD = 'x';
    resetInboxSession();
    stubFetch([['/api/login', () => jsonRes({ error: 'Wrong password.' }, 401)]]);
    const bp = await app.inject({ method: 'POST', url: '/api/inbox/items/1/handle', payload: {} });
    expect(bp.statusCode).toBe(401);
    expect(bp.json().error).toBe('The Inbox password was not accepted.');
  });
});
