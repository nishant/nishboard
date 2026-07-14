// Native Discord widget mode — driven by the desktop client's local RPC API
// (JSON frames over a named pipe, server-side only). These are the LEAN shapes
// the Fastify routes return; the raw RPC wire types stay in
// packages/server/src/lib/discordRpc.ts and never reach the renderer.

/** GET /api/discord/status */
export interface DiscordStatusData {
  /** DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET are configured server-side. */
  configured: boolean;
  /** The Discord DESKTOP client is reachable over its local RPC pipe. */
  running: boolean;
  /** RPC session is authenticated (consent granted, token valid). */
  connected: boolean;
  user?: DiscordUserData;
}

/** A Discord user, resolved to display fields (nick/global_name preferred). */
export interface DiscordUserData {
  id: string;
  username: string;
  avatarUrl: string | null;
}

export interface DiscordGuildData {
  id: string;
  name: string;
  iconUrl: string | null;
}

/** Collapsed channel type — the RPC's numeric `type` mapped server-side.
 *  'text' includes announcement channels; 'voice' includes stages. */
export type DiscordChannelKind = 'text' | 'voice' | 'category' | 'other';

export interface DiscordChannelData {
  id: string;
  name: string;
  kind: DiscordChannelKind;
}

export interface DiscordMessageData {
  id: string;
  channelId: string;
  author: DiscordUserData;
  /** Plain text — the renderer renders it as text (escaped by React). */
  content: string;
  /** ISO timestamp. */
  timestamp: string;
  edited: boolean;
  attachmentCount: number;
  hasEmbeds: boolean;
}

/** GET /api/discord/channels/:id — channel + its recent messages. */
export interface DiscordChannelDetailData {
  id: string;
  name: string;
  kind: DiscordChannelKind;
  /** Oldest → newest (render newest at the bottom). */
  messages: DiscordMessageData[];
}

export interface DiscordVoiceMemberData {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Any mute flavor (self, server, suppress) — shows the slash icon. */
  mute: boolean;
  deaf: boolean;
  speaking: boolean;
}

/** The voice channel the user is currently in (all-null/empty when not). */
export interface DiscordSelectedVoiceData {
  channelId: string | null;
  channelName: string | null;
  guildId: string | null;
  members: DiscordVoiceMemberData[];
}

export interface DiscordVoiceSettingsData {
  mute: boolean;
  deaf: boolean;
}

/** One SSE frame on GET /api/discord/stream?channelId=…
 *  `state` fires on connect and on pipe-level transitions; `voice-roster` is a
 *  full resync of the current VC (speaking flips ride the lighter `speaking`
 *  frame); `message`/`message-delete` cover the subscribed text channel. */
export type DiscordStreamEvent =
  | { type: 'state'; running: boolean; connected: boolean }
  | { type: 'voice-roster'; voice: DiscordSelectedVoiceData }
  | { type: 'speaking'; userId: string; speaking: boolean }
  | { type: 'message'; action: 'create' | 'update'; message: DiscordMessageData }
  | { type: 'message-delete'; channelId: string; messageId: string }
  | { type: 'notification'; channelId: string; title: string; body: string };

/** POST /api/discord/voice/select — null = leave the current voice channel. */
export interface DiscordVoiceSelectRequestBody {
  channelId: string | null;
}

/** POST /api/discord/voice/settings — partial toggle. */
export interface DiscordVoiceSettingsRequestBody {
  mute?: boolean;
  deaf?: boolean;
}

/** POST /api/discord/select-text-channel — jumps the DESKTOP client there. */
export interface DiscordSelectTextChannelRequestBody {
  channelId: string;
}
