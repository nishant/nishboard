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
import { ALLOWED_ORIGINS } from '../lib/access';

// Discord native mode — local RPC to the RUNNING desktop client (see
// lib/discordRpc.ts for the pipe transport). This file owns the HTTP surface
// plus the SSE hub: RPC DISPATCH events fan out to every open /stream response.

const SNOWFLAKE = '^[0-9]{5,25}$';

// reply.hijack() bypasses @fastify/cors, so the SSE stream sets
// Access-Control-Allow-Origin itself from ALLOWED_ORIGINS (lib/access.ts).

// Voice events are subscribed per voice channel_id; message events per text
// channel_id; the two globals need no args.
const VOICE_EVENTS = ['VOICE_STATE_CREATE', 'VOICE_STATE_UPDATE', 'VOICE_STATE_DELETE', 'SPEAKING_START', 'SPEAKING_STOP'];
const MESSAGE_EVENTS = ['MESSAGE_CREATE', 'MESSAGE_UPDATE', 'MESSAGE_DELETE'];

// ── SSE hub state (module singleton — one RPC pipe, one hub) ─────────────────

interface SseClient {
  raw: ServerResponse;
  ended: boolean;
  /** The text channel this stream's window is viewing (null = none). */
  channelId: string | null;
}

const sseClients = new Set<SseClient>();
// The voice channel we're subscribed to + its live roster (speaking overlaid
// from SPEAKING_* events). Resubscribed whenever VOICE_CHANNEL_SELECT fires.
let voiceChannelId: string | null = null;
let voiceChannelName: string | null = null;
let voiceGuildId: string | null = null;
let roster = new Map<string, ReturnType<typeof mapVoiceMember>>();
// Text channels with live MESSAGE_* subscriptions: reference-counted by the
// open streams' channelIds (subscribe on the first, unsubscribe on the last).
const subscribedTextChannels = new Set<string>();
// Voice channel the VOICE_*/SPEAKING_* subs currently target. Separate from
// voiceChannelId (the displayed one) and set synchronously, before any await.
let subscribedVoiceChannel: string | null = null;
let adoptGen = 0;
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

function sendToChannel(channelId: string, event: DiscordStreamEvent): void {
  for (const client of sseClients) {
    if (client.channelId === channelId) sendTo(client, event);
  }
}

/** Reconcile MESSAGE_* subscriptions with the channels the open streams view:
 *  one subscription per channel while at least one stream wants it. Sub/unsub
 *  failures are non-fatal — a dropped pipe resets everything anyway. */
function syncTextSubs(rpc: DiscordRpcClient): void {
  const wanted = new Set<string>();
  for (const client of sseClients) {
    if (!client.ended && client.channelId) wanted.add(client.channelId);
  }
  for (const id of [...subscribedTextChannels]) {
    if (wanted.has(id)) continue;
    subscribedTextChannels.delete(id);
    for (const evt of MESSAGE_EVENTS) void rpc.unsubscribe(evt, { channel_id: id }).catch(() => undefined);
  }
  for (const id of wanted) {
    if (subscribedTextChannels.has(id)) continue;
    subscribedTextChannels.add(id);
    for (const evt of MESSAGE_EVENTS) void rpc.subscribe(evt, { channel_id: id }).catch(() => undefined);
  }
}

/** Move the voice subscriptions + roster to a new VC (null = left voice) and
 *  broadcast the fresh roster. Concurrent calls: the newest wins. */
async function adoptVoiceChannel(rpc: DiscordRpcClient, channelId: string | null): Promise<void> {
  const gen = ++adoptGen;
  const prev = subscribedVoiceChannel;
  if (prev && prev !== channelId) {
    subscribedVoiceChannel = null;
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
  if (subscribedVoiceChannel !== channelId) {
    subscribedVoiceChannel = channelId;
    for (const evt of VOICE_EVENTS) void rpc.subscribe(evt, { channel_id: channelId }).catch(() => undefined);
  }
  const chan = await rpc.getChannel(channelId);
  if (gen !== adoptGen) return; // a newer adopt superseded this one
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function handleDispatch(rpc: DiscordRpcClient, evt: string, data: unknown): void {
  if (!isRecord(data)) return;
  switch (evt) {
    case 'VOICE_CHANNEL_SELECT': {
      // The user joined/left/moved voice (from the widget OR the real client).
      void adoptVoiceChannel(rpc, str(data.channel_id) ?? null).catch(() => undefined);
      break;
    }
    case 'VOICE_STATE_CREATE':
    case 'VOICE_STATE_UPDATE': {
      // Narrowed to a record above; mapVoiceMember reads its fields defensively.
      const m = mapVoiceMember(data as RpcVoiceState);
      if (!m.userId) break;
      const existing = roster.get(m.userId);
      roster.set(m.userId, { ...m, speaking: existing?.speaking ?? false });
      broadcast({ type: 'voice-roster', voice: currentVoice() });
      break;
    }
    case 'VOICE_STATE_DELETE': {
      const id = isRecord(data.user) ? str(data.user.id) : undefined;
      if (id && roster.delete(id)) broadcast({ type: 'voice-roster', voice: currentVoice() });
      break;
    }
    case 'SPEAKING_START':
    case 'SPEAKING_STOP': {
      const userId = str(data.user_id);
      if (!userId) break;
      const speaking = evt === 'SPEAKING_START';
      const member = roster.get(userId);
      if (member) member.speaking = speaking;
      broadcast({ type: 'speaking', userId, speaking });
      break;
    }
    case 'MESSAGE_CREATE':
    case 'MESSAGE_UPDATE': {
      const channelId = str(data.channel_id);
      if (!channelId || !isRecord(data.message)) break;
      sendToChannel(channelId, {
        type: 'message',
        action: evt === 'MESSAGE_CREATE' ? 'create' : 'update',
        message: mapMessage(data.message as unknown as RpcMessage, channelId),
      });
      break;
    }
    case 'MESSAGE_DELETE': {
      const channelId = str(data.channel_id);
      const messageId = isRecord(data.message) ? str(data.message.id) : undefined;
      if (!channelId || !messageId) break;
      sendToChannel(channelId, { type: 'message-delete', channelId, messageId });
      break;
    }
    case 'NOTIFICATION_CREATE': {
      broadcast({
        type: 'notification',
        channelId: str(data.channel_id) ?? '',
        title: str(data.title) ?? '',
        body: str(data.body) ?? '',
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
    subscribedTextChannels.clear();
    subscribedVoiceChannel = null;
    adoptGen++;
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
  // the old one); each stream only receives its own channel's message frames.
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

      const client: SseClient = { raw, ended: false, channelId: req.query.channelId ?? null };
      sseClients.add(client);

      // Reap on the RESPONSE stream's 'close', NEVER req.raw: an
      // http.IncomingMessage fires 'close' the moment its request side is
      // done, long before the SSE response finishes (see routes/claude.ts and
      // the CLAUDE.md gotcha — keying off req.raw silently killed streams).
      // Registered BEFORE any await so a client that aborts while the roster
      // is being primed is still removed. The `ended` guard skips the close
      // our own raw.end() triggers.
      raw.on('close', () => {
        client.ended = true;
        sseClients.delete(client);
        // Last viewer of a channel gone -> drop that channel's message
        // subscription (voice subs stay so a reopened stream re-primes fast).
        syncTextSubs(rpc);
      });

      sendTo(client, { type: 'state', running: true, connected: true });

      ensureGlobalSubs(rpc);
      syncTextSubs(rpc);

      // Prime the voice roster. When the hub already tracks a VC just replay
      // it to this client; otherwise ask the client where the user is.
      if (voiceChannelId !== null) {
        sendTo(client, { type: 'voice-roster', voice: currentVoice() });
      } else {
        try {
          const chan = await rpc.getSelectedVoiceChannel();
          if (client.ended || raw.destroyed) return;
          await adoptVoiceChannel(rpc, chan?.id ?? null);
          if (client.ended || raw.destroyed) return;
          // adoptVoiceChannel broadcast to everyone EXCEPT it may have run
          // before this client could observe a null->null no-op - send the
          // current state explicitly so the widget always gets one roster.
          sendTo(client, { type: 'voice-roster', voice: currentVoice() });
        } catch {
          sendTo(client, { type: 'voice-roster', voice: currentVoice() });
        }
      }
    },
  );
};
