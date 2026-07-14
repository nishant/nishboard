import type { FastifyPluginAsync } from 'fastify';
import type { ServerResponse } from 'http';
import type {
  DiscordChannelDetailData,
  DiscordSelectedVoiceData,
  DiscordSelectTextChannelRequestBody,
  DiscordStatusData,
  DiscordStreamEvent,
  DiscordUserData,
  DiscordVoiceSelectRequestBody,
  DiscordVoiceSettingsRequestBody,
} from '@dash/shared';
import type { DiscordRpcClient, RpcMessage, RpcVoiceState } from '../lib/discordRpc';
import {
  getDiscordRpc,
  mapChannelKind,
  mapMessage,
  mapVoiceMember,
} from '../lib/discordRpc';
import { cred } from '../lib/env';

// Discord native mode — local RPC to the RUNNING desktop client (see
// lib/discordRpc.ts for the pipe transport). This file owns the HTTP surface
// plus the SSE hub: RPC DISPATCH events fan out to every open /stream response.

const SNOWFLAKE = '^[0-9]{5,25}$';

// Mirror of app.ts's CORS origin list. reply.hijack() bypasses @fastify/cors
// entirely, so the SSE response must set Access-Control-Allow-Origin itself —
// only ever echoing an origin from this allowed set. Keep in sync with app.ts
// (and routes/claude.ts, the other hijacked route).
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'file://', 'null']);

// Voice events are subscribed per voice channel_id; message events per text
// channel_id; the two globals need no args.
const VOICE_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'];
const MESSAGE_EVENTS = ['MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE'];

// ── SSE hub state (module singleton — one RPC pipe, one hub) ─────────────────

interface SseClient {
  raw: ServerResponse;
  ended: boolean;
}

const sseClients = new Set<SseClient>();
// The voice channel we're subscribed to + its live roster (speaking overlaid
// from SPEAKING_* events). Resubscribed whenever VOICE_CHANNEL_SELECT fires.
let voiceChannelId: string | null = null;
let voiceChannelName: string | null = null;
let voiceGuildId: string | null = null;
let roster = new Map<string, ReturnType<typeof mapVoiceMember>>();
// The text channel the widget is viewing (MESSAGE_* subscription target).
let textChannelId: string | null = null;
// Global subs (VOICE_CHANNEL_SELECT + NOTIFICATION_CREATE) — once per pipe
// session; reset when the pipe closes.
let globalSubsActive = false;
let hubWired = false;

function currentVoice(): DiscordSelectedVoiceData {
  return {
    channelId: voiceChannelId,
    channelName: voiceChannelName,
    guildId: voiceGuildId,
    members: [...roster.values()],
  };
}

function sendTo(client: SseClient, event: DiscordStreamEvent): void {
  if (client.ended) return;
  try {
    client.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    client.ended = true;
  }
}

function broadcast(event: DiscordStreamEvent): void {
  for (const client of sseClients) sendTo(client, event);
}

/** Switch the MESSAGE_* subscription to a new channel (null = none). Sub/unsub
 *  failures are non-fatal — a dropped pipe resets everything anyway. */
function adoptTextChannel(rpc: DiscordRpcClient, channelId: string | null): void {
  if (textChannelId === channelId) return;
  const prev = textChannelId;
  textChannelId = channelId;
  if (prev) {
    for (const evt of MESSAGE_EVENTS) void rpc.unsubscribe(evt, { channel_id: prev }).catch(() => undefined);
  }
  if (channelId) {
    for (const evt of MESSAGE_EVENTS) void rpc.subscribe(evt, { channel_id: channelId }).catch(() => undefined);
  }
}

/** Move the voice subscriptions + roster to a new VC (null = left voice) and
 *  broadcast the fresh roster. */
async function adoptVoiceChannel(rpc: DiscordRpcClient, channelId: string | null): Promise<void> {
  const prev = voiceChannelId;
  if (prev && prev !== channelId) {
    for (const evt of VOICE_EVENTS) void rpc.unsubscribe(evt, { channel_id: prev }).catch(() => undefined);
  }
  if (!channelId) {
    voiceChannelId = null;
    voiceChannelName = null;
    voiceGuildId = null;
    roster = new Map();
    broadcast({ type: 'voice-roster', voice: currentVoice() });
    return;
  }
  const chan = await rpc.getChannel(channelId);
  if (prev !== channelId) {
    for (const evt of VOICE_EVENTS) void rpc.subscribe(evt, { channel_id: channelId }).catch(() => undefined);
  }
  voiceChannelId = channelId;
  voiceChannelName = chan.name ?? null;
  voiceGuildId = chan.guild_id ?? null;
  roster = new Map(
    (chan.voice_states ?? []).map((v) => {
      const m = mapVoiceMember(v);
      return [m.userId, m] as const;
    }),
  );
  broadcast({ type: 'voice-roster', voice: currentVoice() });
}

function ensureGlobalSubs(rpc: DiscordRpcClient): void {
  if (globalSubsActive) return;
  globalSubsActive = true;
  void rpc.subscribe('VOICE_CHANNEL_SELECT').catch(() => {
    globalSubsActive = false;
  });
  // Needs rpc.notifications.read — non-fatal if the grant predates the scope.
  void rpc.subscribe('NOTIFICATION_CREATE').catch(() => undefined);
}

function handleDispatch(rpc: DiscordRpcClient, evt: string, data: unknown): void {
  switch (evt) {
    case 'VOICE_CHANNEL_SELECT': {
      // The user joined/left/moved voice (from the widget OR the real client).
      const d = data as { channel_id?: string | null };
      void adoptVoiceChannel(rpc, d.channel_id ?? null).catch(() => undefined);
      break;
    }
    case 'VOICE_STATE_CREATE':
    case 'VOICE_STATE_UPDATE': {
      const m = mapVoiceMember(data as RpcVoiceState);
      if (!m.userId) break;
      const existing = roster.get(m.userId);
      roster.set(m.userId, { ...m, speaking: existing?.speaking ?? false });
      broadcast({ type: 'voice-roster', voice: currentVoice() });
      break;
    }
    case 'VOICE_STATE_DELETE': {
      const id = (data as RpcVoiceState).user?.id;
      if (id && roster.delete(id)) broadcast({ type: 'voice-roster', voice: currentVoice() });
      break;
    }
    case 'SPEAKING_START':
    case 'SPEAKING_STOP': {
      const d = data as { user_id?: string };
      if (!d.user_id) break;
      const speaking = evt === 'SPEAKING_START';
      const member = roster.get(d.user_id);
      if (member) member.speaking = speaking;
      broadcast({ type: 'speaking', userId: d.user_id, speaking });
      break;
    }
    case 'MESSAGE_CREATE':
    case 'MESSAGE_UPDATE': {
      const d = data as { channel_id?: string; message?: RpcMessage };
      if (!d.channel_id || d.channel_id !== textChannelId || !d.message) break;
      broadcast({
        type: 'message',
        action: evt === 'MESSAGE_CREATE' ? 'create' : 'update',
        message: mapMessage(d.message, d.channel_id),
      });
      break;
    }
    case 'MESSAGE_DELETE': {
      const d = data as { channel_id?: string; message?: { id?: string } };
      if (!d.channel_id || d.channel_id !== textChannelId || !d.message?.id) break;
      broadcast({ type: 'message-delete', channelId: d.channel_id, messageId: d.message.id });
      break;
    }
    case 'NOTIFICATION_CREATE': {
      const d = data as { channel_id?: string; title?: string; body?: string };
      broadcast({
        type: 'notification',
        channelId: d.channel_id ?? '',
        title: d.title ?? '',
        body: d.body ?? '',
      });
      break;
    }
  }
}

/** Wire the hub to the pipe client exactly once per process. */
function wireHub(rpc: DiscordRpcClient): void {
  if (hubWired) return;
  hubWired = true;
  rpc.onDispatch((evt, data) => handleDispatch(rpc, evt, data));
  rpc.onClose(() => {
    // Pipe gone (Discord quit / crashed): reset every subscription assumption
    // and END the streams — the renderer refetches status and shows the
    // "not running" panel until the pipe is back.
    globalSubsActive = false;
    voiceChannelId = null;
    voiceChannelName = null;
    voiceGuildId = null;
    roster = new Map();
    textChannelId = null;
    for (const client of sseClients) {
      sendTo(client, { type: 'state', running: false, connected: false });
      client.ended = true;
      try {
        client.raw.end();
      } catch {
        // socket already gone
      }
    }
    sseClients.clear();
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

export const discordRoutes: FastifyPluginAsync = async (fastify) => {
  const rpc = getDiscordRpc();
  wireHub(rpc);

  // GET /api/discord/status — pipe reachability + auth state. Never 5xx for
  // the expected "Discord isn't running / not connected" states.
  fastify.get<{ Reply: DiscordStatusData }>('/status', async (_req, reply) => {
    const configured = Boolean(cred('DISCORD_CLIENT_ID') && cred('DISCORD_CLIENT_SECRET'));
    if (!configured) return reply.send({ configured, running: false, connected: false });
    try {
      await rpc.connect();
    } catch {
      return reply.send({ configured, running: false, connected: false });
    }
    try {
      // Silent re-auth from ~/.dash/discord_rpc_tokens.json — a dashboard
      // restart reconnects without the user touching anything.
      const user = await rpc.authenticate();
      return reply.send({ configured, running: true, connected: true, user });
    } catch {
      return reply.send({ configured, running: true, connected: false });
    }
  });

  // POST /api/discord/connect — silent authenticate when tokens exist, else
  // interactive AUTHORIZE (pops the consent modal INSIDE the Discord client —
  // the ~60s timeout is the human clicking it).
  fastify.post<{ Reply: DiscordStatusData }>('/connect', async (_req, reply) => {
    await rpc.connect();
    let user: DiscordUserData;
    try {
      user = await rpc.authenticate();
    } catch {
      user = await rpc.authorizeInteractive();
    }
    return reply.send({ configured: true, running: true, connected: true, user });
  });

  // POST /api/discord/disconnect — drop tokens + the live pipe session.
  fastify.post('/disconnect', async (_req, reply) => {
    rpc.clearAuth();
    return reply.code(204).send();
  });

  // GET /api/discord/guilds
  fastify.get('/guilds', async (_req, reply) => {
    await rpc.authenticate();
    return reply.send({ guilds: await rpc.getGuilds() });
  });

  // GET /api/discord/guilds/:id/channels
  fastify.get<{ Params: { id: string } }>(
    '/guilds/:id/channels',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: SNOWFLAKE } },
        },
      },
    },
    async (req, reply) => {
      await rpc.authenticate();
      return reply.send({ channels: await rpc.getChannels(req.params.id) });
    },
  );

  // GET /api/discord/channels/:id — channel + recent messages (text channels).
  fastify.get<{ Params: { id: string }; Reply: DiscordChannelDetailData }>(
    '/channels/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', pattern: SNOWFLAKE } },
        },
      },
    },
    async (req, reply) => {
      await rpc.authenticate();
      const chan = await rpc.getChannel(req.params.id);
      const messages = (chan.messages ?? [])
        .map((m) => mapMessage(m, chan.id))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return reply.send({
        id: chan.id,
        name: chan.name,
        kind: mapChannelKind(chan.type),
        messages,
      });
    },
  );

  // GET /api/discord/voice/selected — the VC the user is in right now.
  fastify.get<{ Reply: DiscordSelectedVoiceData }>('/voice/selected', async (_req, reply) => {
    await rpc.authenticate();
    const chan = await rpc.getSelectedVoiceChannel();
    // Adopt it so the hub's subscriptions/roster line up even when the user
    // joined from the real client before any stream was open.
    await adoptVoiceChannel(rpc, chan?.id ?? null);
    return reply.send(currentVoice());
  });

  // POST /api/discord/voice/select — join a VC (channelId) or leave (null).
  fastify.post<{ Body: DiscordVoiceSelectRequestBody; Reply: DiscordSelectedVoiceData }>(
    '/voice/select',
    {
      schema: {
        body: {
          type: 'object',
          required: ['channelId'],
          additionalProperties: false,
          properties: { channelId: { type: ['string', 'null'], pattern: SNOWFLAKE } },
        },
      },
    },
    async (req, reply) => {
      await rpc.authenticate();
      const chan = await rpc.selectVoiceChannel(req.body.channelId);
      // Don't rely solely on the VOICE_CHANNEL_SELECT dispatch — adopt now so
      // the response already carries the fresh roster.
      await adoptVoiceChannel(rpc, chan?.id ?? null);
      return reply.send(currentVoice());
    },
  );

  // GET /api/discord/voice/settings — current mute/deafen.
  fastify.get('/voice/settings', async (_req, reply) => {
    await rpc.authenticate();
    return reply.send(await rpc.getVoiceSettings());
  });

  // POST /api/discord/voice/settings — partial { mute?, deaf? } toggle.
  fastify.post<{ Body: DiscordVoiceSettingsRequestBody }>(
    '/voice/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { mute: { type: 'boolean' }, deaf: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      await rpc.authenticate();
      return reply.send(await rpc.setVoiceSettings(req.body));
    },
  );

  // POST /api/discord/select-text-channel — jump the DESKTOP client to the
  // channel ("Reply in Discord").
  fastify.post<{ Body: DiscordSelectTextChannelRequestBody }>(
    '/select-text-channel',
    {
      schema: {
        body: {
          type: 'object',
          required: ['channelId'],
          additionalProperties: false,
          properties: { channelId: { type: 'string', pattern: SNOWFLAKE } },
        },
      },
    },
    async (req, reply) => {
      await rpc.authenticate();
      await rpc.selectTextChannel(req.body.channelId);
      return reply.code(204).send();
    },
  );

  // GET /api/discord/stream?channelId=… — hijacked SSE of DiscordStreamEvent
  // frames: voice roster, speaking, messages (for channelId), notifications.
  // Viewing a different text channel = the client opens a NEW stream (closing
  // the old one); the hub's MESSAGE_* subscription follows last-writer-wins.
  fastify.get<{ Querystring: { channelId?: string } }>(
    '/stream',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { channelId: { type: 'string', pattern: SNOWFLAKE } },
        },
      },
    },
    async (req, reply) => {
      // Auth BEFORE hijacking — failures must go through the central error
      // handler as normal JSON (503 not running / 401 not connected).
      await rpc.connect();
      await rpc.authenticate();

      // Past this point we own the raw socket — @fastify/cors and the central
      // error handler no longer apply.
      reply.hijack();
      const raw = reply.raw;
      const headers: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      const origin = req.headers.origin;
      if (origin !== undefined && ALLOWED_ORIGINS.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
      }
      raw.writeHead(200, headers);

      const client: SseClient = { raw, ended: false };
      sseClients.add(client);
      sendTo(client, { type: 'state', running: true, connected: true });

      ensureGlobalSubs(rpc);
      adoptTextChannel(rpc, req.query.channelId ?? null);

      // Prime the voice roster. When the hub already tracks a VC just replay
      // it to this client; otherwise ask the client where the user is.
      if (voiceChannelId !== null) {
        sendTo(client, { type: 'voice-roster', voice: currentVoice() });
      } else {
        try {
          const chan = await rpc.getSelectedVoiceChannel();
          await adoptVoiceChannel(rpc, chan?.id ?? null);
          // adoptVoiceChannel broadcast to everyone EXCEPT it may have run
          // before this client could observe a null→null no-op — send the
          // current state explicitly so the widget always gets one roster.
          sendTo(client, { type: 'voice-roster', voice: currentVoice() });
        } catch {
          sendTo(client, { type: 'voice-roster', voice: currentVoice() });
        }
      }

      // Reap on the RESPONSE stream's 'close', NEVER req.raw: an
      // http.IncomingMessage fires 'close' the moment its request side is
      // done, long before the SSE response finishes (see routes/claude.ts and
      // the CLAUDE.md gotcha — keying off req.raw silently killed streams).
      // The `ended` guard skips the close our own raw.end() triggers.
      raw.on('close', () => {
        client.ended = true;
        sseClients.delete(client);
        // Last viewer gone → stop the message subscription (hygiene; voice
        // subs stay so a reopened stream re-primes instantly).
        if (sseClients.size === 0) adoptTextChannel(rpc, null);
      });
    },
  );
};
