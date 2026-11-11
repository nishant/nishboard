import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import http from 'node:http';
import net from 'node:net';
import { registerAccessGuard } from '../lib/access';
import type { FastifyInstance } from 'fastify';
import type { SpawnClaudeChatOpts } from '../lib/claudeCli';

// The chat route spawns the real Claude Code CLI — stub the whole module so the
// test drives the request lifecycle, not an actual subprocess.
vi.mock('../lib/claudeCli', () => ({
  spawnClaudeChat: vi.fn(),
  claudeStatus: vi.fn(async () => ({ available: true, version: 'test' })),
  getClaudeMeta: vi.fn(async () => ({ slashCommands: [], model: null })),
}));

import { claudeRoutes } from './claude';
import { spawnClaudeChat } from '../lib/claudeCli';

const mockSpawn = vi.mocked(spawnClaudeChat);

// A REAL socket is mandatory here: the bug this guards against is that an
// http.IncomingMessage fires 'close' the instant its POST body is fully read —
// which app.inject()/light-my-request does NOT reproduce. Only a genuine listen
// + fetch exercises that lifecycle.
async function listen(): Promise<{ app: FastifyInstance; url: string }> {
  const app = Fastify({ logger: false });
  await app.register(claudeRoutes, { prefix: '/api/claude' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, url: `http://127.0.0.1:${port}` };
}

describe('POST /api/claude/chat — request lifecycle', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    vi.clearAllMocks();
  });

  it('streams every frame instead of killing the child when the POST body ends (regression: keyed off req.raw close)', async () => {
    // Emit on a delay so the child is still "running" when req.raw's 'close'
    // fires right after the body is consumed. The pre-fix route reaped the child
    // here, so zero frames ever reached the client.
    mockSpawn.mockImplementation((opts: SpawnClaudeChatOpts) => {
      let killed = false;
      setTimeout(() => {
        if (killed) return;
        opts.onEvent({ type: 'init', sessionId: 'sess-1', model: 'test-model' });
        opts.onEvent({ type: 'delta', text: 'hello' });
        opts.onEvent({ type: 'done', isError: false, durationMs: 1, outputTokens: null, contextTokens: null });
        opts.onExit();
      }, 40);
      return {
        kill: () => {
          killed = true;
        },
        respondControl: () => false,
      };
    });

    const server = await listen();
    app = server.app;

    const controller = new AbortController();
    const res = await fetch(`${server.url}/api/claude/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
      signal: controller.signal,
    });
    expect(res.status).toBe(200);

    // If the child were killed before spawning, the stream never ends. Abort on
    // a short deadline so a regression fails fast (and frees the socket for
    // app.close()) instead of hanging until the vitest timeout.
    const timer = setTimeout(() => controller.abort(), 2000);
    let body: string;
    try {
      body = await res.text();
    } finally {
      clearTimeout(timer);
    }

    expect(body).toContain('"type":"init"');
    expect(body).toContain('"type":"delta"');
    expect(body).toContain('"type":"done"');
    expect(mockSpawn).toHaveBeenCalledOnce();
  });

  it('reaps the CLI child when the client disconnects mid-stream', async () => {
    let killed = false;
    mockSpawn.mockImplementation((opts: SpawnClaudeChatOpts) => {
      // Init only, then a long-running turn that never finishes on its own —
      // the only way it ends is a client-disconnect kill().
      setTimeout(() => opts.onEvent({ type: 'init', sessionId: 's', model: 'm' }), 10);
      return {
        kill: () => {
          killed = true;
          // The real handle's child-close fires onExit, releasing the
          // single-flight slot — mirror it so later tests aren't 409'd.
          opts.onExit();
        },
        respondControl: () => false,
      };
    });

    const server = await listen();
    app = server.app;

    const controller = new AbortController();
    const inflight = fetch(`${server.url}/api/claude/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
      signal: controller.signal,
    }).catch(() => undefined); // abort rejects the fetch — swallow it

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    controller.abort();
    await inflight;
    await vi.waitFor(() => expect(killed).toBe(true));
  });
});

const doneFrame = { type: 'done', isError: false, durationMs: 1, outputTokens: null, contextTokens: null } as const;

async function postControl(url: string): Promise<number> {
  const res = await fetch(`${url}/api/claude/control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'r1', response: { behavior: 'allow' } }),
  });
  return res.status;
}

describe('POST /api/claude/chat — resume retry and single-flight release', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    vi.clearAllMocks();
  });

  it('retries once without --resume when the session is unknown; the first child\'s late exit keeps the slot', async () => {
    const opts: SpawnClaudeChatOpts[] = [];
    const respond = [vi.fn(() => false), vi.fn(() => true)];
    mockSpawn.mockImplementation((o: SpawnClaudeChatOpts) => {
      opts.push(o);
      return { kill: vi.fn(), respondControl: respond[opts.length - 1] };
    });

    const server = await listen();
    app = server.app;
    const resPromise = fetch(`${server.url}/api/claude/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', sessionId: '0b1f9c2e-3a4d-4e5f-8a6b-7c8d9e0f1a2b' }),
    });

    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));
    expect(opts[0].sessionId).toBe('0b1f9c2e-3a4d-4e5f-8a6b-7c8d9e0f1a2b');
    // The CLI tags the error with a code; the route never regexes the message.
    opts[0].onEvent({ type: 'error', message: 'No conversation found with session ID' }, { code: 'session-not-found' });

    // The retry spawned synchronously, as a fresh chat.
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(opts[1].sessionId).toBeUndefined();

    // The superseded first child exits late: it must not free the slot.
    opts[0].onExit();
    expect(await postControl(server.url)).toBe(204);
    expect(respond[1]).toHaveBeenCalled();
    expect(respond[0]).not.toHaveBeenCalled();

    opts[1].onEvent({ type: 'init', sessionId: 'fresh-session', model: 'm' });
    opts[1].onEvent(doneFrame);
    opts[1].onExit();
    const body = await (await resPromise).text();
    expect(body).toContain('"type":"init"');
    expect(body).toContain('"type":"done"');
    expect(body).not.toContain('"type":"error"');
    expect(mockSpawn).toHaveBeenCalledTimes(2);
  });

  it('releases the slot at the done frame and kills the lingering child when a new chat arrives', async () => {
    const opts: SpawnClaudeChatOpts[] = [];
    const kills = [vi.fn(), vi.fn()];
    mockSpawn.mockImplementation((o: SpawnClaudeChatOpts) => {
      opts.push(o);
      return { kill: kills[opts.length - 1], respondControl: () => true };
    });

    const server = await listen();
    app = server.app;
    const post = (): Promise<Response> =>
      fetch(`${server.url}/api/claude/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      });

    const first = post();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));
    opts[0].onEvent({ type: 'init', sessionId: 's1', model: 'm' });
    opts[0].onEvent(doneFrame);
    expect((await first).status).toBe(200);
    // The child is still exiting (no onExit yet), but the slot is already free.
    expect(await postControl(server.url)).toBe(409);

    const second = post();
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2));
    expect(kills[0]).toHaveBeenCalled();
    opts[1].onEvent({ type: 'init', sessionId: 's2', model: 'm' });
    expect((await second).status).toBe(200);

    // The old child's exit arrives late and must not release the new chat.
    opts[0].onExit();
    expect(await postControl(server.url)).toBe(204);

    opts[1].onEvent(doneFrame);
    opts[1].onExit();
  });
});

describe('POST /api/claude/control + chat body extensions', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    vi.clearAllMocks();
  });

  async function startChat(url: string, extra: Record<string, unknown> = {}) {
    // Fire a chat that never finishes so activeChat stays set; caller aborts.
    const controller = new AbortController();
    const inflight = fetch(`${url}/api/claude/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', ...extra }),
      signal: controller.signal,
    }).catch(() => undefined);
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    return { controller, inflight };
  }

  it('409 when no chat is active', async () => {
    const server = await listen();
    app = server.app;
    const res = await fetch(`${server.url}/api/claude/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'r1', response: { behavior: 'allow' } }),
    });
    expect(res.status).toBe(409);
  });

  it('204 when the handle accepts; 404 for unknown request ids', async () => {
    const respondControl = vi.fn((id: string) => id === 'known');
    mockSpawn.mockImplementation((opts: SpawnClaudeChatOpts) => ({ kill: () => opts.onExit(), respondControl }));
    const server = await listen();
    app = server.app;
    const { controller, inflight } = await startChat(server.url);

    const ok = await fetch(`${server.url}/api/claude/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'known', response: { behavior: 'allow', answers: [['Blue']] } }),
    });
    expect(ok.status).toBe(204);
    expect(respondControl).toHaveBeenCalledWith('known', { behavior: 'allow', answers: [['Blue']] });

    const missing = await fetch(`${server.url}/api/claude/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'other', response: { behavior: 'deny' } }),
    });
    expect(missing.status).toBe(404);

    controller.abort();
    await inflight;
  });

  it('legacy mode "chat" is coerced to "ask"; ~ paths expand; relative paths 400', async () => {
    mockSpawn.mockImplementation((opts: SpawnClaudeChatOpts) => ({ kill: () => opts.onExit(), respondControl: () => false }));
    const server = await listen();
    app = server.app;

    const { controller, inflight } = await startChat(server.url, {
      mode: 'chat',
      workspaceDir: '~/projects',
      additionalDirs: ['~'],
    });
    expect(mockSpawn).toHaveBeenCalledOnce();
    const opts = mockSpawn.mock.calls[0][0];
    expect(opts.mode).toBe('ask');
    expect(opts.workspaceDir).toMatch(/^([A-Za-z]:)?[\\/].*projects$/);
    expect(opts.workspaceDir?.includes('~')).toBe(false);
    expect(opts.additionalDirs?.[0].includes('~')).toBe(false);
    controller.abort();
    await inflight;
    // The route clears activeChat once the killed child's onExit fires.
    await vi.waitFor(async () => expect(await postControl(server.url)).toBe(409));

    const bad = await fetch(`${server.url}/api/claude/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', workspaceDir: 'relative/path' }),
    });
    expect(bad.status).toBe(400);

    // Control characters, '%' and quotes are rejected by the schema.
    for (const workspaceDir of ['/tmp/bad\u0000dir', '/tmp/50%', '/tmp/a"b']) {
      const res = await fetch(`${server.url}/api/claude/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hi', workspaceDir }),
      });
      expect(res.status).toBe(400);
    }
    const dirs = await fetch(`${server.url}/api/claude/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi', additionalDirs: ['/ok', '/bad%PATH%'] }),
    });
    expect(dirs.status).toBe(400);

    // NISHBOARD-216: only a UUID is a valid session id — a flag-shaped value
    // would otherwise reach argv next to --resume.
    for (const sessionId of ['--dangerously-skip-permissions', '-abcdefgh', 'sess-resume-1']) {
      const res = await fetch(`${server.url}/api/claude/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'hi', sessionId }),
      });
      expect(res.status).toBe(400);
    }
  });
});

// ── Hand-rolled CORS on the hijacked SSE route (@fastify/cors never runs) ────

const TOKEN = 'test-token';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

/** node:http, not fetch: fetch treats Origin as a forbidden header. */
function rawPost(
  port: number,
  headers: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message: 'hi' });
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/claude/chat',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
      },
      (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
        res.resume();
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('POST /api/claude/chat — Origin handling and auth', () => {
  let app: FastifyInstance | null = null;

  afterEach(async () => {
    await app?.close();
    app = null;
    vi.clearAllMocks();
  });

  async function guardedServer(): Promise<number> {
    const port = await freePort();
    app = Fastify({ logger: false });
    registerAccessGuard(app, { token: TOKEN, port });
    await app.register(claudeRoutes, { prefix: '/api/claude' });
    await app.listen({ port, host: '127.0.0.1' });
    mockSpawn.mockImplementation((opts: SpawnClaudeChatOpts) => {
      setTimeout(() => {
        opts.onEvent(doneFrame);
        opts.onExit();
      }, 10);
      return { kill: vi.fn(), respondControl: () => false };
    });
    return port;
  }

  it('echoes an allowed origin and withholds ACAO for null and foreign origins', async () => {
    const port = await guardedServer();
    const auth = { Authorization: `Bearer ${TOKEN}` };

    const ok = await rawPost(port, { ...auth, Origin: 'app://nishboard' });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('app://nishboard');

    for (const origin of ['null', 'https://evil.example']) {
      const res = await rawPost(port, { ...auth, Origin: origin });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('returns 401 without the bearer token, before any spawn', async () => {
    const port = await guardedServer();
    const res = await rawPost(port, { Origin: 'app://nishboard' });
    expect(res.status).toBe(401);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
