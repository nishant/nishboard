import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { DiscordStreamEvent, DiscordUserData } from '@dash/shared';
import type { DiscordRpcClient, RpcChannel } from '../lib/discordRpc';

// Mock ONLY the singleton accessor — the pure mapping helpers the route uses
// stay real. The fake client is swapped per test via the hoisted holder.
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../lib/discordRpc', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../lib/discordRpc')>();
  return {
    ...orig,
    // Cast: the fake implements the full method surface the routes touch;
    // the class's private transport fields are irrelevant behind the mock.
    getDiscordRpc: () => holder.client as DiscordRpcClient,
  };
});

const USER: DiscordUserData = { id: 'u1', username: 'Nish', avatarUrl: null };

function makeFakeClient() {
  const dispatchListeners = new Set<(evt: string, data: unknown) => void>();
  const closeListeners = new Set<() => void>();
  return {
    connect: vi.fn(async (): Promise<void> => undefined),
    authenticate: vi.fn(async (): Promise<DiscordUserData> => USER),
    authorizeInteractive: vi.fn(async (): Promise<DiscordUserData> => USER),
    clearAuth: vi.fn(),
    getGuilds: vi.fn(async () => [{ id: 'g1', name: 'Guild One', iconUrl: null }]),
    getChannels: vi.fn(async () => [
      { id: 'c1', name: 'general', kind: 'text' as const },
      { id: 'c2', name: 'Lounge', kind: 'voice' as const },
    ]),
    getChannel: vi.fn(async (id: string): Promise<RpcChannel> => ({ id, name: 'general', type: 0, messages: [] })),
    getSelectedVoiceChannel: vi.fn(async (): Promise<RpcChannel | null> => null),
    selectVoiceChannel: vi.fn(async (): Promise<RpcChannel | null> => null),
    getVoiceSettings: vi.fn(async () => ({ mute: false, deaf: false })),
    setVoiceSettings: vi.fn(async (p: { mute?: boolean; deaf?: boolean }) => ({
      mute: Boolean(p.mute),
      deaf: Boolean(p.deaf),
    })),
    selectTextChannel: vi.fn(async (_id: string): Promise<void> => undefined),
    subscribe: vi.fn(async (_evt: string, _args?: Record<string, unknown>): Promise<void> => undefined),
    unsubscribe: vi.fn(async (_evt: string, _args?: Record<string, unknown>): Promise<void> => undefined),
    onDispatch: vi.fn((fn: (evt: string, data: unknown) => void) => {
      dispatchListeners.add(fn);
      return () => dispatchListeners.delete(fn);
    }),
    onClose: vi.fn((fn: () => void) => {
      closeListeners.add(fn);
      return () => closeListeners.delete(fn);
    }),
    emitDispatch: (evt: string, data: unknown) => {
      for (const fn of dispatchListeners) fn(evt, data);
    },
    emitClose: () => {
      for (const fn of closeListeners) fn();
    },
  };
}

type FakeClient = ReturnType<typeof makeFakeClient>;

let fake: FakeClient;
let app: FastifyInstance | null = null;

// The route module holds hub state (subscriptions, roster, SSE clients) —
// re-import it fresh per test so tests can't bleed into each other.
async function buildApp(): Promise<FastifyInstance> {
  const { discordRoutes } = await import('./discord');
  const instance = Fastify({ logger: false });
  await instance.register(discordRoutes, { prefix: '/api/discord' });
  return instance;
}

async function listen(): Promise<{ app: FastifyInstance; url: string }> {
  const instance = await buildApp();
  await instance.listen({ port: 0, host: '127.0.0.1' });
  const addr = instance.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app: instance, url: `http://127.0.0.1:${port}` };
}

beforeEach(() => {
  vi.resetModules();
  fake = makeFakeClient();
  holder.client = fake;
  vi.stubEnv('DISCORD_CLIENT_ID', 'test-id');
  vi.stubEnv('DISCORD_CLIENT_SECRET', 'test-secret');
});

afterEach(async () => {
  await app?.close();
  app = null;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('GET /api/discord/status', () => {
  it('reports unconfigured without touching the pipe', async () => {
    vi.stubEnv('DISCORD_CLIENT_ID', '');
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/discord/status' });
    expect(res.json()).toEqual({ configured: false, running: false, connected: false });
    expect(fake.connect).not.toHaveBeenCalled();
  });

  it('running:false when the pipe is unreachable', async () => {
    fake.connect.mockRejectedValueOnce(new Error('no pipe'));
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/discord/status' });
    expect(res.json()).toEqual({ configured: true, running: false, connected: false });
  });

  it('connected with user after a silent authenticate', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/discord/status' });
    expect(res.json()).toEqual({ configured: true, running: true, connected: true, user: USER });
  });

  it('running but not connected when authenticate fails', async () => {
    fake.authenticate.mockRejectedValueOnce(new Error('no tokens'));
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/discord/status' });
    expect(res.json()).toEqual({ configured: true, running: true, connected: false });
  });
});

describe('POST /api/discord/connect', () => {
  it('falls back to the interactive AUTHORIZE when silent auth fails', async () => {
    fake.authenticate.mockRejectedValueOnce(new Error('no tokens'));
    app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/discord/connect' });
    expect(res.statusCode).toBe(200);
    expect(fake.authorizeInteractive).toHaveBeenCalledOnce();
    expect(res.json().user).toEqual(USER);
  });
});

describe('REST endpoints', () => {
  it('lists guilds', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/discord/guilds' });
    expect(res.json()).toEqual({ guilds: [{ id: 'g1', name: 'Guild One', iconUrl: null }] });
  });

  it('validates the guild id (snowflake) on the channels route', async () => {
    app = await buildApp();
    const bad = await app.inject({ method: 'GET', url: '/api/discord/guilds/not-a-snowflake/channels' });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'GET', url: '/api/discord/guilds/123456789/channels' });
    expect(ok.statusCode).toBe(200);
    expect(fake.getChannels).toHaveBeenCalledWith('123456789');
  });

  it('returns channel detail with messages mapped + sorted oldest-first', async () => {
    fake.getChannel.mockResolvedValueOnce({
      id: '55555',
      name: 'general',
      type: 0,
      messages: [
        { id: 'm2', content: 'later', timestamp: '2026-07-14T12:05:00Z', author: { id: 'u2', username: 'b' } },
        { id: 'm1', content: 'earlier', timestamp: '2026-07-14T12:00:00Z', author: { id: 'u1', username: 'a' } },
      ],
    });
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/discord/channels/55555' });
    const body = res.json();
    expect(body.kind).toBe('text');
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2']);
  });

  it('voice/select accepts null (leave) and rejects malformed ids', async () => {
    app = await buildApp();
    const leave = await app.inject({
      method: 'POST',
      url: '/api/discord/voice/select',
      payload: { channelId: null },
    });
    expect(leave.statusCode).toBe(200);
    expect(fake.selectVoiceChannel).toHaveBeenCalledWith(null);
    expect(leave.json()).toEqual({ channelId: null, channelName: null, guildId: null, members: [] });

    const bad = await app.inject({
      method: 'POST',
      url: '/api/discord/voice/select',
      payload: { channelId: 'DROP TABLE' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('voice/select join adopts the channel: subscribes voice events + returns the roster', async () => {
    const chan: RpcChannel = {
      id: '777777',
      name: 'Lounge',
      type: 2,
      guild_id: 'g1',
      voice_states: [{ user: { id: 'u1', username: 'Nish' }, voice_state: { self_mute: true } }],
    };
    fake.selectVoiceChannel.mockResolvedValueOnce(chan);
    fake.getChannel.mockResolvedValueOnce(chan);
    app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/discord/voice/select',
      payload: { channelId: '777777' },
    });
    expect(res.json()).toEqual({
      channelId: '777777',
      channelName: 'Lounge',
      guildId: 'g1',
      members: [{ userId: 'u1', name: 'Nish', avatarUrl: null, mute: true, deaf: false, speaking: false }],
    });
    const subscribed = fake.subscribe.mock.calls.map((c) => c[0]);
    expect(subscribed).toEqual(
      expect.arrayContaining(['VOICE_STATE_CREATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP']),
    );
  });

  it('voice settings + select-text-channel proxy through', async () => {
    app = await buildApp();
    const set = await app.inject({
      method: 'POST',
      url: '/api/discord/voice/settings',
      payload: { mute: true },
    });
    expect(set.json()).toEqual({ mute: true, deaf: false });
    expect(fake.setVoiceSettings).toHaveBeenCalledWith({ mute: true });

    const jump = await app.inject({
      method: 'POST',
      url: '/api/discord/select-text-channel',
      payload: { channelId: '424242' },
    });
    expect(jump.statusCode).toBe(204);
    expect(fake.selectTextChannel).toHaveBeenCalledWith('424242');
  });
});

// ── SSE stream — needs a REAL listen(): app.inject can't drive the hijacked
// response lifecycle (see routes/claude.test.ts for the precedent). ──────────

interface StreamHandle {
  controller: AbortController;
  events: DiscordStreamEvent[];
  done: Promise<void>;
}

async function openStream(url: string, qs = ''): Promise<StreamHandle> {
  const controller = new AbortController();
  const res = await fetch(`${url}/api/discord/stream${qs}`, { signal: controller.signal });
  expect(res.status).toBe(200);
  if (!res.body) throw new Error('no stream body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const events: DiscordStreamEvent[] = [];
  let buf = '';
  const done = (async () => {
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx !== -1) {
        const frame = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (frame.startsWith('data: ')) {
          events.push(JSON.parse(frame.slice('data: '.length)) as DiscordStreamEvent);
        }
        idx = buf.indexOf('\n\n');
      }
    }
  })().catch(() => undefined);
  return { controller, events, done };
}

describe('GET /api/discord/stream', () => {
  it('sends state + voice-roster on open, then live message/speaking frames for the subscribed channel', async () => {
    const server = await listen();
    app = server.app;
    const stream = await openStream(server.url, '?channelId=123456');

    await vi.waitFor(() => {
      expect(stream.events.some((e) => e.type === 'state')).toBe(true);
      expect(stream.events.some((e) => e.type === 'voice-roster')).toBe(true);
    });
    expect(stream.events[0]).toEqual({ type: 'state', running: true, connected: true });

    // MESSAGE_* subscriptions follow the queried channel.
    const messageSubs = fake.subscribe.mock.calls.filter((c) => String(c[0]).startsWith('MESSAGE_'));
    expect(messageSubs.map((c) => c[1])).toEqual([
      { channel_id: '123456' },
      { channel_id: '123456' },
      { channel_id: '123456' },
    ]);

    // A create in the viewed channel streams through, mapped lean.
    fake.emitDispatch('MESSAGE_CREATE', {
      channel_id: '123456',
      message: { id: 'm9', content: 'hi', author: { id: 'u2', username: 'friend' }, timestamp: '2026-07-14T12:00:00Z' },
    });
    // A create elsewhere is filtered out.
    fake.emitDispatch('MESSAGE_CREATE', {
      channel_id: '999999',
      message: { id: 'm10', content: 'other', author: { id: 'u3', username: 'x' }, timestamp: '2026-07-14T12:00:01Z' },
    });
    fake.emitDispatch('SPEAKING_START', { channel_id: '777', user_id: 'u2' });

    await vi.waitFor(() => {
      expect(stream.events.some((e) => e.type === 'message')).toBe(true);
      expect(stream.events.some((e) => e.type === 'speaking')).toBe(true);
    });
    const msgEvents = stream.events.filter((e) => e.type === 'message');
    expect(msgEvents).toHaveLength(1);
    expect(msgEvents[0]).toMatchObject({ action: 'create', message: { id: 'm9', content: 'hi' } });
    expect(stream.events.filter((e) => e.type === 'speaking')[0]).toEqual({
      type: 'speaking',
      userId: 'u2',
      speaking: true,
    });

    stream.controller.abort();
    await stream.done;
    // Client-disconnect cleanup runs off the RESPONSE 'close' (the req.raw
    // trap from the Claude SSE bug) — the message subscription is dropped.
    await vi.waitFor(() => {
      const unsubs = fake.unsubscribe.mock.calls.map((c) => c[0]);
      expect(unsubs).toEqual(expect.arrayContaining(['MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE']));
    });
  });

  it('ends every stream with a state frame when the pipe closes', async () => {
    const server = await listen();
    app = server.app;
    const stream = await openStream(server.url);
    await vi.waitFor(() => expect(stream.events.length).toBeGreaterThan(0));

    fake.emitClose();
    await stream.done; // server ended the response
    expect(stream.events.at(-1)).toEqual({ type: 'state', running: false, connected: false });
  });

  it('refuses to hijack when not authenticated (plain JSON error)', async () => {
    fake.authenticate.mockRejectedValue(Object.assign(new Error('Not connected'), { statusCode: 401 }));
    const server = await listen();
    app = server.app;
    const res = await fetch(`${server.url}/api/discord/stream`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});
