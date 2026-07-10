import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { SpawnClaudeChatOpts } from '../lib/claudeCli';

// The chat route spawns the real Claude Code CLI — stub the whole module so the
// test drives the request lifecycle, not an actual subprocess.
vi.mock('../lib/claudeCli', () => ({
  spawnClaudeChat: vi.fn(),
  claudeStatus: vi.fn(async () => ({ available: true, version: 'test' })),
  isSessionNotFoundError: vi.fn(() => false),
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
        opts.onEvent({ type: 'done', isError: false, durationMs: 1 });
        opts.onExit();
      }, 40);
      return {
        kill: () => {
          killed = true;
        },
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
        },
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

    await new Promise((r) => setTimeout(r, 60));
    controller.abort();
    await inflight;
    await new Promise((r) => setTimeout(r, 80));

    expect(killed).toBe(true);
  });
});
