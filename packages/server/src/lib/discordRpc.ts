import net from 'net';
import crypto from 'crypto';
import type {
  DiscordChannelData,
  DiscordChannelKind,
  DiscordGuildData,
  DiscordMessageData,
  DiscordUserData,
  DiscordVoiceMemberData,
  DiscordVoiceSettingsData,
} from '@dash/shared';
import { cred } from './env';
import { fetchJson, HttpError } from './http';
import { UserTokenStore, rethrowRefreshFailure } from './userTokenStore';
import type { StoredUserTokens } from './userTokenStore';

// ── Protocol constants ────────────────────────────────────────────────────────
// Discord's local RPC: little-endian [int32 opcode][int32 length][UTF-8 JSON]
// frames over a named pipe to the RUNNING desktop client. No keepalive is
// required — the client never PINGs in practice; we still answer a PING with a
// PONG defensively (verified optional against the protocol docs).

export const RPC_OP = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2,
  PING: 3,
  PONG: 4,
} as const;

const TOKEN_URL = 'https://discord.com/api/oauth2/token';
// Must match a redirect registered on the Discord application — the RPC
// AUTHORIZE code is exchanged against it even though no browser ever visits it.
const REDIRECT_URI = 'http://localhost:7432/api/discord/callback';
const RPC_SCOPES = ['rpc', 'rpc.voice.read', 'rpc.voice.write', 'rpc.notifications.read', 'messages.read'];

const HANDSHAKE_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
/** AUTHORIZE waits on a human clicking the consent modal inside Discord. */
const AUTHORIZE_TIMEOUT_MS = 60_000;
/** Per-candidate pipe connect attempt — a dead path fails near-instantly, this
 *  only bounds pathological cases. */
const PIPE_CONNECT_TIMEOUT_MS = 2_000;

// ── Wire framing (pure — unit-tested) ─────────────────────────────────────────

export interface RpcFrame {
  op: number;
  /** Parsed JSON payload; null for an empty (length 0) frame. */
  payload: unknown;
}

/** Encode one RPC frame: LE int32 opcode + LE int32 byte length + UTF-8 JSON. */
export function encodeRpcFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Incremental frame decoder. Pipes deliver arbitrary chunk boundaries — a
 *  frame can arrive split across chunks or several frames can coalesce into
 *  one chunk; `push` buffers and returns every COMPLETE frame available. */
export class RpcFrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): RpcFrame[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const frames: RpcFrame[] = [];
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0);
      const len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break; // partial frame — wait for more
      const body = this.buf.subarray(8, 8 + len).toString('utf8');
      this.buf = this.buf.subarray(8 + len);
      frames.push({ op, payload: len === 0 ? null : (JSON.parse(body) as unknown) });
    }
    return frames;
  }
}

// ── Pipe discovery ────────────────────────────────────────────────────────────

/** Candidate pipe paths, discord-ipc-0 … discord-ipc-9.
 *  Windows-only: named pipes under `\\?\pipe\`.
 *  macOS/Linux-only: unix sockets under the user temp dir
 *  ($XDG_RUNTIME_DIR, then $TMPDIR, then /tmp). */
export function pipeCandidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const idx = Array.from({ length: 10 }, (_, i) => i);
  if (platform === 'win32') {
    return idx.map((i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  }
  const base = (env.XDG_RUNTIME_DIR || env.TMPDIR || '/tmp').replace(/\/$/, '');
  return idx.map((i) => `${base}/discord-ipc-${i}`);
}

// ── Raw wire shapes (server-internal — routes map them to @dash/shared) ──────

export interface RpcUser {
  id: string;
  username: string;
  avatar?: string | null;
  global_name?: string | null;
}

export interface RpcGuild {
  id: string;
  name: string;
  icon_url?: string | null;
}

export interface RpcChannelSummary {
  id: string;
  name: string;
  type: number;
}

export interface RpcMessage {
  id: string;
  content?: string;
  author?: RpcUser;
  nick?: string;
  timestamp?: string;
  edited_timestamp?: string | null;
  attachments?: unknown[];
  embeds?: unknown[];
}

export interface RpcVoiceState {
  nick?: string;
  user?: RpcUser;
  voice_state?: {
    mute?: boolean;
    deaf?: boolean;
    self_mute?: boolean;
    self_deaf?: boolean;
    suppress?: boolean;
  };
}

export interface RpcChannel extends RpcChannelSummary {
  guild_id?: string | null;
  messages?: RpcMessage[];
  voice_states?: RpcVoiceState[];
}

interface RpcVoiceSettings {
  mute?: boolean;
  deaf?: boolean;
}

/** One decoded FRAME payload — command responses and DISPATCH events share it. */
interface RpcPayload {
  cmd?: string;
  nonce?: string | null;
  evt?: string | null;
  data?: unknown;
}

// ── Pure mapping helpers (unit-tested) ────────────────────────────────────────

/** CDN avatar for a user; null when they have no custom avatar (the renderer
 *  falls back to an initial). */
export function rpcAvatarUrl(user: RpcUser | undefined): string | null {
  if (!user?.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
}

/** Server nick > global display name > raw username. */
export function rpcDisplayName(user: RpcUser | undefined, nick?: string): string {
  return nick || user?.global_name || user?.username || 'Unknown';
}

/** Collapse the RPC's numeric channel type: 0 text / 5 announcement → text;
 *  2 voice / 13 stage → voice; 4 → category; everything else 'other'. */
export function mapChannelKind(type: number): DiscordChannelKind {
  if (type === 0 || type === 5) return 'text';
  if (type === 2 || type === 13) return 'voice';
  if (type === 4) return 'category';
  return 'other';
}

export function mapGuild(g: RpcGuild): DiscordGuildData {
  return { id: g.id, name: g.name, iconUrl: g.icon_url ?? null };
}

export function mapChannel(c: RpcChannelSummary): DiscordChannelData {
  return { id: c.id, name: c.name, kind: mapChannelKind(c.type) };
}

export function mapUser(u: RpcUser | undefined, nick?: string): DiscordUserData {
  return {
    id: u?.id ?? '',
    username: rpcDisplayName(u, nick),
    avatarUrl: rpcAvatarUrl(u),
  };
}

export function mapMessage(m: RpcMessage, channelId: string): DiscordMessageData {
  return {
    id: m.id,
    channelId,
    author: mapUser(m.author, m.nick),
    content: m.content ?? '',
    timestamp: m.timestamp ?? '',
    edited: m.edited_timestamp != null,
    attachmentCount: m.attachments?.length ?? 0,
    hasEmbeds: (m.embeds?.length ?? 0) > 0,
  };
}

/** `speaking` starts false — SPEAKING_START/STOP dispatches overlay it. */
export function mapVoiceMember(v: RpcVoiceState): DiscordVoiceMemberData {
  const vs = v.voice_state ?? {};
  return {
    userId: v.user?.id ?? '',
    name: rpcDisplayName(v.user, v.nick),
    avatarUrl: rpcAvatarUrl(v.user),
    mute: Boolean(vs.mute || vs.self_mute || vs.suppress),
    deaf: Boolean(vs.deaf || vs.self_deaf),
    speaking: false,
  };
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** The Discord desktop client is not reachable (no pipe / handshake failed).
 *  Routes map this to a clean `running: false` status instead of a 5xx. */
export class DiscordUnavailableError extends HttpError {
  constructor(message = 'Discord desktop app is not running') {
    super(503, message);
    this.name = 'DiscordUnavailableError';
  }
}

/** The RPC session is not authenticated — the widget shows Connect. */
export class DiscordNotConnectedError extends HttpError {
  constructor(message = 'Not connected to Discord — connect from the widget') {
    super(401, message);
    this.name = 'DiscordNotConnectedError';
  }
}

// ── Token persistence (~/.dash/discord_rpc_tokens.json) ──────────────────────

async function refreshDiscordToken(refreshToken: string): Promise<StoredUserTokens> {
  // Same guard as Twitch: without credentials the endpoint 4xxes and would
  // masquerade as a dead grant, wiping a valid session.
  if (!cred('DISCORD_CLIENT_ID') || !cred('DISCORD_CLIENT_SECRET')) {
    throw new HttpError(503, 'Discord client credentials not configured — cannot refresh token');
  }
  try {
    const data = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number }>(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: cred('DISCORD_CLIENT_ID'),
          client_secret: cred('DISCORD_CLIENT_SECRET'),
        }),
      },
      { label: 'Discord token refresh' },
    );
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? refreshToken,
      expires_at: Date.now() + data.expires_in * 1000,
    };
  } catch (err) {
    // Definitive 4xx → RefreshAuthError → store clears → widget shows Connect.
    rethrowRefreshFailure(err);
  }
}

// ── The pipe client ───────────────────────────────────────────────────────────

type DispatchListener = (evt: string, data: unknown) => void;
type CloseListener = () => void;

interface PendingRequest {
  resolve: (payload: RpcPayload) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface DiscordRpcClientOpts {
  /** Override pipe candidates (tests run against a fake pipe server). */
  paths?: string[];
  tokenStore?: UserTokenStore;
}

/**
 * Single stateful connection to the Discord desktop client's local RPC pipe.
 *
 * Lifecycle: disconnected → (connect: pipe + HANDSHAKE + READY) ready →
 * (authenticate/authorize) authenticated. Any pipe error/close tears the whole
 * thing down (pending requests rejected, close listeners notified) and the
 * next call reconnects from scratch. All calls are single-flighted where
 * concurrent invocation would race (connect, authenticate).
 */
export class DiscordRpcClient {
  private socket: net.Socket | null = null;
  private decoder = new RpcFrameDecoder();
  private pending = new Map<string, PendingRequest>();
  private ready = false;
  private authedUser: DiscordUserData | null = null;
  private connectInFlight: Promise<void> | null = null;
  private authInFlight: Promise<DiscordUserData> | null = null;
  private readyWaiter: { resolve: () => void; reject: (err: Error) => void } | null = null;
  private dispatchListeners = new Set<DispatchListener>();
  private closeListeners = new Set<CloseListener>();
  private readonly paths: string[] | null;
  private readonly tokens: UserTokenStore;

  constructor(opts: DiscordRpcClientOpts = {}) {
    this.paths = opts.paths ?? null;
    this.tokens = opts.tokenStore ?? new UserTokenStore('discord_rpc_tokens.json', refreshDiscordToken);
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isAuthenticated(): boolean {
    return this.authedUser !== null;
  }

  get user(): DiscordUserData | null {
    return this.authedUser;
  }

  get hasStoredTokens(): boolean {
    return this.tokens.authenticated;
  }

  onDispatch(fn: DispatchListener): () => void {
    this.dispatchListeners.add(fn);
    return () => this.dispatchListeners.delete(fn);
  }

  onClose(fn: CloseListener): () => void {
    this.closeListeners.add(fn);
    return () => this.closeListeners.delete(fn);
  }

  // ── Connection ──────────────────────────────────────────────────────────────

  /** Idempotent: resolves immediately when the pipe is already handshaken. */
  async connect(): Promise<void> {
    if (this.ready) return;
    this.connectInFlight ??= this.doConnect().finally(() => {
      this.connectInFlight = null;
    });
    return this.connectInFlight;
  }

  private async doConnect(): Promise<void> {
    const clientId = cred('DISCORD_CLIENT_ID');
    if (!clientId) {
      throw new HttpError(503, 'DISCORD_CLIENT_ID not configured — add it in Settings → Developer');
    }
    const candidates = this.paths ?? pipeCandidates();
    let socket: net.Socket | null = null;
    for (const path of candidates) {
      socket = await this.tryPipe(path);
      if (socket) break;
    }
    if (!socket) throw new DiscordUnavailableError();

    this.socket = socket;
    this.decoder = new RpcFrameDecoder();
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => this.teardown());
    socket.on('close', () => this.teardown());

    // HANDSHAKE → the client answers with DISPATCH READY (op FRAME). An
    // invalid client_id instead gets a CLOSE frame / socket close → reject.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiter = null;
        this.teardown();
        reject(new DiscordUnavailableError('Discord RPC handshake timed out'));
      }, HANDSHAKE_TIMEOUT_MS);
      this.readyWaiter = {
        resolve: () => {
          clearTimeout(timer);
          this.readyWaiter = null;
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          this.readyWaiter = null;
          reject(err);
        },
      };
      socket.write(encodeRpcFrame(RPC_OP.HANDSHAKE, { v: 1, client_id: clientId }));
    });
  }

  /** One candidate path — resolves null on any failure (try the next). */
  private tryPipe(path: string): Promise<net.Socket | null> {
    return new Promise((resolve) => {
      const sock = net.connect(path);
      const timer = setTimeout(() => {
        sock.destroy();
        resolve(null);
      }, PIPE_CONNECT_TIMEOUT_MS);
      sock.once('connect', () => {
        clearTimeout(timer);
        sock.removeAllListeners('error');
        resolve(sock);
      });
      sock.once('error', () => {
        clearTimeout(timer);
        sock.destroy();
        resolve(null);
      });
    });
  }

  private onData(chunk: Buffer): void {
    let frames: RpcFrame[];
    try {
      frames = this.decoder.push(chunk);
    } catch {
      // Malformed JSON mid-stream — desync, tear down and reconnect fresh.
      this.teardown();
      return;
    }
    for (const frame of frames) this.onFrame(frame);
  }

  private onFrame(frame: RpcFrame): void {
    if (frame.op === RPC_OP.PING) {
      this.socket?.write(encodeRpcFrame(RPC_OP.PONG, frame.payload));
      return;
    }
    if (frame.op === RPC_OP.CLOSE) {
      // The client is closing us (e.g. bad client id mid-handshake). Payload
      // carries { code, message } — surface it to a pending handshake.
      const p = frame.payload as { code?: number; message?: string } | null;
      this.readyWaiter?.reject(
        new DiscordUnavailableError(`Discord RPC closed: ${p?.message ?? 'unknown reason'}`),
      );
      this.teardown();
      return;
    }
    if (frame.op !== RPC_OP.FRAME) return;
    const payload = frame.payload as RpcPayload;

    if (payload.cmd === 'DISPATCH') {
      if (payload.evt === 'READY') {
        this.ready = true;
        this.readyWaiter?.resolve();
        return;
      }
      if (typeof payload.evt === 'string') {
        for (const fn of this.dispatchListeners) fn(payload.evt, payload.data);
      }
      return;
    }

    // Command response — matched to its caller by nonce.
    const nonce = payload.nonce;
    if (typeof nonce !== 'string') return;
    const req = this.pending.get(nonce);
    if (!req) return;
    this.pending.delete(nonce);
    clearTimeout(req.timer);
    if (payload.evt === 'ERROR') {
      const data = payload.data as { code?: number; message?: string } | undefined;
      req.reject(new HttpError(502, `Discord RPC error ${data?.code ?? '?'}: ${data?.message ?? 'unknown'}`));
    } else {
      req.resolve(payload);
    }
  }

  /** Reject everything in flight and reset to disconnected. Auth STATE resets
   *  too (a fresh pipe needs a fresh AUTHENTICATE) — stored tokens survive. */
  private teardown(): void {
    const sock = this.socket;
    this.socket = null;
    sock?.destroy();
    const wasReady = this.ready;
    this.ready = false;
    this.authedUser = null;
    this.readyWaiter?.reject(new DiscordUnavailableError('Discord RPC connection closed'));
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new DiscordUnavailableError('Discord RPC connection closed'));
    }
    this.pending.clear();
    if (wasReady) for (const fn of this.closeListeners) fn();
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  private async request<T>(
    cmd: string,
    args: Record<string, unknown>,
    opts: { evt?: string; timeoutMs?: number } = {},
  ): Promise<T> {
    await this.connect();
    const socket = this.socket;
    if (!socket) throw new DiscordUnavailableError();
    const nonce = crypto.randomUUID();
    const payload = await new Promise<RpcPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new HttpError(504, `Discord RPC ${cmd} timed out`));
      }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
      this.pending.set(nonce, { resolve, reject, timer });
      // SUBSCRIBE/UNSUBSCRIBE carry the event name TOP-LEVEL (`evt`), not in args.
      socket.write(encodeRpcFrame(RPC_OP.FRAME, { cmd, args, evt: opts.evt, nonce }));
    });
    return payload.data as T;
  }

  async subscribe(evt: string, args: Record<string, unknown> = {}): Promise<void> {
    await this.request('SUBSCRIBE', args, { evt });
  }

  async unsubscribe(evt: string, args: Record<string, unknown> = {}): Promise<void> {
    await this.request('UNSUBSCRIBE', args, { evt });
  }

  async getGuilds(): Promise<DiscordGuildData[]> {
    const data = await this.request<{ guilds?: RpcGuild[] }>('GET_GUILDS', {});
    return (data.guilds ?? []).map(mapGuild);
  }

  async getChannels(guildId: string): Promise<DiscordChannelData[]> {
    const data = await this.request<{ channels?: RpcChannelSummary[] }>('GET_CHANNELS', { guild_id: guildId });
    return (data.channels ?? []).map(mapChannel);
  }

  /** Full channel — includes ~last 50 messages (text) / voice_states (voice). */
  async getChannel(channelId: string): Promise<RpcChannel> {
    return this.request<RpcChannel>('GET_CHANNEL', { channel_id: channelId });
  }

  /** Join (or with null: leave) a voice channel. `force` skips the desktop
   *  client's are-you-sure when already in another VC — that IS our switch UX. */
  async selectVoiceChannel(channelId: string | null): Promise<RpcChannel | null> {
    return this.request<RpcChannel | null>('SELECT_VOICE_CHANNEL', {
      channel_id: channelId,
      force: true,
    });
  }

  async getSelectedVoiceChannel(): Promise<RpcChannel | null> {
    return this.request<RpcChannel | null>('GET_SELECTED_VOICE_CHANNEL', {});
  }

  async getVoiceSettings(): Promise<DiscordVoiceSettingsData> {
    const data = await this.request<RpcVoiceSettings>('GET_VOICE_SETTINGS', {});
    return { mute: Boolean(data.mute), deaf: Boolean(data.deaf) };
  }

  async setVoiceSettings(patch: { mute?: boolean; deaf?: boolean }): Promise<DiscordVoiceSettingsData> {
    const args: Record<string, unknown> = {};
    if (patch.mute !== undefined) args.mute = patch.mute;
    if (patch.deaf !== undefined) args.deaf = patch.deaf;
    const data = await this.request<RpcVoiceSettings>('SET_VOICE_SETTINGS', args);
    return { mute: Boolean(data.mute), deaf: Boolean(data.deaf) };
  }

  /** Jump the DESKTOP client to a text channel ("Reply in Discord"). */
  async selectTextChannel(channelId: string): Promise<void> {
    await this.request('SELECT_TEXT_CHANNEL', { channel_id: channelId });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  /** Silent authenticate from stored tokens (refreshing when expired). Throws
   *  DiscordNotConnectedError when there is no usable session — callers show
   *  Connect. Never pops the consent modal. */
  async authenticate(): Promise<DiscordUserData> {
    if (this.ready && this.authedUser) return this.authedUser;
    this.authInFlight ??= this.doAuthenticate().finally(() => {
      this.authInFlight = null;
    });
    return this.authInFlight;
  }

  private async doAuthenticate(): Promise<DiscordUserData> {
    await this.connect();
    if (this.authedUser) return this.authedUser;
    if (!this.tokens.authenticated) throw new DiscordNotConnectedError();
    let accessToken: string;
    try {
      accessToken = await this.tokens.getValidToken();
    } catch {
      // Refresh definitively failed (store cleared itself) or transiently
      // failed — either way there's no usable token right now.
      throw new DiscordNotConnectedError();
    }
    try {
      return await this.finishAuthenticate(accessToken);
    } catch {
      // Token minted for a different client id, or access revoked in Discord's
      // settings — the stored grant is dead. Clear so status flips to Connect.
      this.tokens.clear();
      throw new DiscordNotConnectedError();
    }
  }

  /** Interactive AUTHORIZE — pops the consent modal INSIDE the Discord client,
   *  exchanges the code for tokens, persists them, then AUTHENTICATEs. */
  async authorizeInteractive(): Promise<DiscordUserData> {
    const clientId = cred('DISCORD_CLIENT_ID');
    const clientSecret = cred('DISCORD_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new HttpError(503, 'DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET not configured');
    }
    await this.connect();
    const auth = await this.request<{ code?: string }>(
      'AUTHORIZE',
      { client_id: clientId, scopes: RPC_SCOPES },
      { timeoutMs: AUTHORIZE_TIMEOUT_MS },
    );
    if (!auth.code) throw new HttpError(502, 'Discord AUTHORIZE returned no code');
    const data = await fetchJson<{ access_token: string; refresh_token: string; expires_in: number }>(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: auth.code,
          redirect_uri: REDIRECT_URI,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      },
      { label: 'Discord token exchange' },
    );
    this.tokens.store({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    });
    return this.finishAuthenticate(data.access_token);
  }

  private async finishAuthenticate(accessToken: string): Promise<DiscordUserData> {
    const data = await this.request<{ user?: RpcUser }>('AUTHENTICATE', { access_token: accessToken });
    this.authedUser = mapUser(data.user);
    return this.authedUser;
  }

  /** Disconnect: drop persisted tokens AND the live pipe session. */
  clearAuth(): void {
    this.tokens.clear();
    this.teardown();
  }
}

// Module singleton — one pipe connection per server process. Routes always go
// through this accessor so tests can mock it in isolation.
let singleton: DiscordRpcClient | null = null;

export function getDiscordRpc(): DiscordRpcClient {
  singleton ??= new DiscordRpcClient();
  return singleton;
}
