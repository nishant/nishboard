import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import net from 'node:net';
import { buildServer, requestLogShape } from '../app';
import { RENDERER_HEADERS, TEST_API_TOKEN, TEST_PORT, testServer } from '../test/server';

type App = Awaited<ReturnType<typeof testServer>>;
let app: App;
beforeAll(async () => {
  app = await testServer();
});
afterAll(async () => {
  await app.close();
});

const HOST = RENDERER_HEADERS.host;
const AUTH = RENDERER_HEADERS.authorization;

describe('access guard: bearer token', () => {
  it('refuses an /api route without the token', async () => {
    const res = await app.rawInject({ method: 'GET', url: '/api/credentials/builtin', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Not authenticated.' });
  });

  it('refuses a wrong token, a token of another length and a non-Bearer scheme', async () => {
    for (const authorization of ['Bearer nope', `Bearer ${TEST_API_TOKEN}x`, `Basic ${TEST_API_TOKEN}`, TEST_API_TOKEN]) {
      const res = await app.rawInject({ method: 'GET', url: '/api/credentials/builtin', headers: { host: HOST, authorization } });
      expect(res.statusCode, authorization).toBe(401);
    }
  });

  it('answers with the token', async () => {
    const res = await app.rawInject({ method: 'GET', url: '/api/credentials/builtin', headers: { host: HOST, authorization: AUTH } });
    expect(res.statusCode).toBe(200);
  });

  it('covers the Claude chat SSE and control routes (auto mode spawns the CLI)', async () => {
    for (const url of ['/api/claude/chat', '/api/claude/control']) {
      const res = await app.rawInject({ method: 'POST', url, headers: { host: HOST }, payload: { prompt: 'hi', mode: 'auto' } });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('covers routes that match nothing, so a new route is protected by default', async () => {
    const res = await app.rawInject({ method: 'GET', url: '/api/nope', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
  });

  it('leaves /health, the iframe embeds and the OAuth callbacks open, each with its own answer', async () => {
    // Expected status per open route: the embeds serve with valid params, and a
    // callback with no code/state is refused by the handler (400), not the guard.
    const open: [string, number][] = [
      ['/health', 200],
      ['/api/youtube/embed?videoId=dQw4w9WgXcQ', 200],
      ['/api/twitch/embed?channel=nish', 200],
      ['/api/weather/radar-embed?lat=30&lon=-97', 200],
      ['/api/spotify/callback', 400],
      ['/api/youtube/callback', 400],
      ['/api/twitch/callback', 400],
      ['/api/calendar/callback', 400],
    ];
    for (const [url, status] of open) {
      const res = await app.rawInject({ method: 'GET', url, headers: { host: 'localhost:7432' } });
      expect(res.statusCode, url).toBe(status);
    }
  });

  it('refuses a bare OPTIONS without the token, but answers a real preflight', async () => {
    const bare = await app.rawInject({ method: 'OPTIONS', url: '/api/credentials/builtin', headers: { host: HOST } });
    // @fastify/cors 11 rejects a preflight with no Access-Control-Request-Method itself (400);
    // the guard's 401 covers anything that gets past it. Either way: refused, not 2xx.
    expect([400, 401]).toContain(bare.statusCode);
    const preflight = await app.rawInject({
      method: 'OPTIONS',
      url: '/api/credentials/builtin',
      headers: { host: HOST, origin: 'app://nishboard', 'access-control-request-method': 'GET' },
    });
    expect(preflight.statusCode).toBe(204);
  });

  it('opens those routes to GET only', async () => {
    const res = await app.rawInject({ method: 'POST', url: '/api/youtube/embed', headers: { host: HOST } });
    expect(res.statusCode).toBe(401);
  });
});

describe('access guard: Host allowlist', () => {
  it('refuses a rebinding host name and other ports, with or without the token', async () => {
    for (const host of ['evil.example:7432', 'evil.example', '127.0.0.1', '127.0.0.1:80', 'localhost:7433', '[::1]:7432', '0.0.0.0:7432']) {
      const res = await app.rawInject({ method: 'GET', url: '/api/credentials/builtin', headers: { host, authorization: AUTH } });
      expect(res.statusCode, host).toBe(403);
    }
  });

  it('refuses a bad host on the open routes too', async () => {
    const res = await app.rawInject({ method: 'GET', url: '/health', headers: { host: 'evil.example:7432' } });
    expect(res.statusCode).toBe(403);
  });

  it('accepts 127.0.0.1 and localhost on the server port, any case', async () => {
    for (const host of ['127.0.0.1:7432', 'localhost:7432', 'LOCALHOST:7432']) {
      const res = await app.rawInject({ method: 'GET', url: '/health', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });
});

describe('access guard: CORS', () => {
  const preflight = (origin: string) =>
    app.rawInject({
      method: 'OPTIONS',
      url: '/api/claude/chat',
      headers: {
        host: HOST,
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

  it('allows the app:// renderer and the Vite dev server', async () => {
    for (const origin of ['app://nishboard', 'http://localhost:5173']) {
      const res = await preflight(origin);
      expect(res.headers['access-control-allow-origin'], origin).toBe(origin);
      expect(String(res.headers['access-control-allow-headers'])).toContain('authorization');
    }
  });

  it('no longer allows null, file:// or any web origin', async () => {
    for (const origin of ['null', 'file://', 'https://evil.example', 'app://evil']) {
      const res = await preflight(origin);
      expect(res.headers['access-control-allow-origin'], origin).toBeUndefined();
    }
  });

  it('keeps CORS headers on a 401 so the renderer can read the error', async () => {
    const res = await app.rawInject({ method: 'GET', url: '/api/credentials/builtin', headers: { host: HOST, origin: 'app://nishboard' } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe('app://nishboard');
  });
});

describe('access guard: request targets', () => {
  /** A raw socket: inject and fetch both normalize the target, which is the
   *  part an encoded-path bypass lives in (nishant/trading had one). */
  function rawStatus(port: number, target: string, host: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      });
      let data = '';
      socket.on('data', (c) => (data += c.toString()));
      socket.on('end', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0)));
      socket.on('error', reject);
    });
  }

  /** A free port, known before buildServer so its Host allowlist matches. */
  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(port));
      });
      srv.on('error', reject);
    });
  }

  it('an encoded or odd spelling of a protected route still needs the token', async () => {
    const port = await freePort();
    const live = await buildServer({ logger: false, apiToken: TEST_API_TOKEN, port });
    await live.listen({ port, host: '127.0.0.1' });
    try {
      const host = `127.0.0.1:${port}`;
      for (const target of ['/%61pi/credentials/builtin', '/api/credentials/%62uiltin', '/API/credentials/builtin', '//api/credentials/builtin', '/api/claude/%63hat']) {
        expect(await rawStatus(port, target, host), target).toBe(401);
      }
      expect(await rawStatus(port, '/health', host)).toBe(200);
      expect(await rawStatus(port, 'http://evil.example/health', 'evil.example')).toBe(403);
    } finally {
      await live.close();
    }
  });
});

describe('buildServer without a token', () => {
  it('refuses to start', async () => {
    const saved = process.env.DASH_API_TOKEN;
    delete process.env.DASH_API_TOKEN;
    await expect(buildServer({ logger: false })).rejects.toThrow(/DASH_API_TOKEN/);
    if (saved !== undefined) process.env.DASH_API_TOKEN = saved;
  });

  it('takes the token from the environment and removes it there', async () => {
    process.env.DASH_API_TOKEN = 'from-env';
    const s = await buildServer({ logger: false, port: TEST_PORT });
    expect(process.env.DASH_API_TOKEN).toBeUndefined();
    const res = await s.inject({ method: 'GET', url: '/api/credentials/builtin', headers: { host: HOST, authorization: 'Bearer from-env' } });
    expect(res.statusCode).toBe(200);
    await s.close();
  });
});

describe('request log shape', () => {
  it('keeps method, path and host but drops the query string (OAuth codes, search text)', () => {
    expect(requestLogShape({ method: 'GET', url: '/api/spotify/callback?code=SECRET&state=abc', headers: { host: HOST } }))
      .toEqual({ method: 'GET', url: '/api/spotify/callback', host: HOST });
  });
});
