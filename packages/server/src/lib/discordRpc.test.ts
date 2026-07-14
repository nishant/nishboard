import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DiscordRpcClient,
  RPC_OP,
  RpcFrameDecoder,
  encodeRpcFrame,
  mapChannelKind,
  mapMessage,
  mapVoiceMember,
  pipeCandidates,
  rpcAvatarUrl,
  rpcDisplayName,
} from './discordRpc';
import type { RpcFrame } from './discordRpc';

// ── Framing ───────────────────────────────────────────────────────────────────

describe('encodeRpcFrame', () => {
  it('writes LE opcode + LE byte length + UTF-8 JSON', () => {
    const buf = encodeRpcFrame(RPC_OP.HANDSHAKE, { v: 1, client_id: 'abc' });
    expect(buf.readInt32LE(0)).toBe(0);
    expect(buf.readInt32LE(4)).toBe(buf.length - 8);
    expect(JSON.parse(buf.subarray(8).toString('utf8'))).toEqual({ v: 1, client_id: 'abc' });
  });

  it('measures BYTES, not code units, for non-ASCII payloads', () => {
    const buf = encodeRpcFrame(RPC_OP.FRAME, { name: 'café ✻' });
    expect(buf.readInt32LE(4)).toBe(Buffer.byteLength(JSON.stringify({ name: 'café ✻' }), 'utf8'));
  });
});

describe('RpcFrameDecoder', () => {
  it('decodes one whole frame', () => {
    const dec = new RpcFrameDecoder();
    const frames = dec.push(encodeRpcFrame(1, { cmd: 'DISPATCH', evt: 'READY' }));
    expect(frames).toEqual([{ op: 1, payload: { cmd: 'DISPATCH', evt: 'READY' } }]);
  });

  it('reassembles a frame split across arbitrary chunk boundaries', () => {
    const dec = new RpcFrameDecoder();
    const whole = encodeRpcFrame(1, { nonce: 'n1', data: { hello: 'world' } });
    // Split mid-header AND mid-payload.
    expect(dec.push(whole.subarray(0, 3))).toEqual([]);
    expect(dec.push(whole.subarray(3, 12))).toEqual([]);
    const frames = dec.push(whole.subarray(12));
    expect(frames).toHaveLength(1);
    expect(frames[0].payload).toEqual({ nonce: 'n1', data: { hello: 'world' } });
  });

  it('returns multiple frames coalesced into one chunk', () => {
    const dec = new RpcFrameDecoder();
    const chunk = Buffer.concat([
      encodeRpcFrame(1, { nonce: 'a' }),
      encodeRpcFrame(1, { nonce: 'b' }),
      encodeRpcFrame(3, { seq: 1 }),
    ]);
    const frames = dec.push(chunk);
    expect(frames.map((f: RpcFrame) => f.op)).toEqual([1, 1, 3]);
    expect(frames.map((f: RpcFrame) => f.payload)).toEqual([{ nonce: 'a' }, { nonce: 'b' }, { seq: 1 }]);
  });

  it('yields a null payload for an empty (length 0) frame', () => {
    const dec = new RpcFrameDecoder();
    const head = Buffer.alloc(8);
    head.writeInt32LE(2, 0);
    head.writeInt32LE(0, 4);
    expect(dec.push(head)).toEqual([{ op: 2, payload: null }]);
  });

  it('keeps a trailing partial frame buffered across pushes', () => {
    const dec = new RpcFrameDecoder();
    const a = encodeRpcFrame(1, { nonce: 'a' });
    const b = encodeRpcFrame(1, { nonce: 'b' });
    const first = dec.push(Buffer.concat([a, b.subarray(0, 5)]));
    expect(first).toHaveLength(1);
    const second = dec.push(b.subarray(5));
    expect(second).toEqual([{ op: 1, payload: { nonce: 'b' } }]);
  });
});

// ── Pipe discovery ────────────────────────────────────────────────────────────

describe('pipeCandidates', () => {
  it('Windows-only: named pipes under \\\\?\\pipe\\', () => {
    const paths = pipeCandidates('win32', {});
    expect(paths).toHaveLength(10);
    expect(paths[0]).toBe('\\\\?\\pipe\\discord-ipc-0');
    expect(paths[9]).toBe('\\\\?\\pipe\\discord-ipc-9');
  });

  it('macOS-only: unix sockets under $TMPDIR', () => {
    const paths = pipeCandidates('darwin', { TMPDIR: '/var/folders/xy/T/' });
    expect(paths[0]).toBe('/var/folders/xy/T/discord-ipc-0');
  });

  it('prefers $XDG_RUNTIME_DIR over $TMPDIR, falls back to /tmp', () => {
    expect(pipeCandidates('linux', { XDG_RUNTIME_DIR: '/run/user/1000', TMPDIR: '/x' })[0]).toBe(
      '/run/user/1000/discord-ipc-0',
    );
    expect(pipeCandidates('linux', {})[0]).toBe('/tmp/discord-ipc-0');
  });
});

// ── Mapping ───────────────────────────────────────────────────────────────────

describe('mapping helpers', () => {
  it('mapChannelKind collapses the RPC numeric types', () => {
    expect(mapChannelKind(0)).toBe('text');
    expect(mapChannelKind(5)).toBe('text'); // announcement
    expect(mapChannelKind(2)).toBe('voice');
    expect(mapChannelKind(13)).toBe('voice'); // stage
    expect(mapChannelKind(4)).toBe('category');
    expect(mapChannelKind(15)).toBe('other'); // forum
  });

  it('rpcDisplayName prefers nick > global_name > username', () => {
    const user = { id: '1', username: 'raw', global_name: 'Global' };
    expect(rpcDisplayName(user, 'Nick')).toBe('Nick');
    expect(rpcDisplayName(user)).toBe('Global');
    expect(rpcDisplayName({ id: '1', username: 'raw' })).toBe('raw');
    expect(rpcDisplayName(undefined)).toBe('Unknown');
  });

  it('rpcAvatarUrl builds the CDN url and nulls when avatar-less', () => {
    expect(rpcAvatarUrl({ id: '42', username: 'u', avatar: 'hash' })).toBe(
      'https://cdn.discordapp.com/avatars/42/hash.png?size=64',
    );
    expect(rpcAvatarUrl({ id: '42', username: 'u', avatar: null })).toBeNull();
    expect(rpcAvatarUrl(undefined)).toBeNull();
  });

  it('mapMessage produces the lean shape (attachments count, embeds flag, edited)', () => {
    const mapped = mapMessage(
      {
        id: 'm1',
        content: 'hello <script>',
        author: { id: 'u1', username: 'nish', avatar: 'av' },
        nick: 'Nish',
        timestamp: '2026-07-14T12:00:00.000Z',
        edited_timestamp: '2026-07-14T12:01:00.000Z',
        attachments: [{}, {}],
        embeds: [{}],
      },
      'c1',
    );
    expect(mapped).toEqual({
      id: 'm1',
      channelId: 'c1',
      author: { id: 'u1', username: 'Nish', avatarUrl: 'https://cdn.discordapp.com/avatars/u1/av.png?size=64' },
      content: 'hello <script>',
      timestamp: '2026-07-14T12:00:00.000Z',
      edited: true,
      attachmentCount: 2,
      hasEmbeds: true,
    });
  });

  it('mapVoiceMember ORs the mute flavors and starts speaking=false', () => {
    const base = { user: { id: 'u1', username: 'nish' } };
    expect(mapVoiceMember({ ...base, voice_state: { self_mute: true } }).mute).toBe(true);
    expect(mapVoiceMember({ ...base, voice_state: { mute: true } }).mute).toBe(true);
    expect(mapVoiceMember({ ...base, voice_state: { suppress: true } }).mute).toBe(true);
    expect(mapVoiceMember({ ...base, voice_state: { self_deaf: true } }).deaf).toBe(true);
    const m = mapVoiceMember({ ...base, voice_state: {} });
    expect(m).toEqual({ userId: 'u1', name: 'nish', avatarUrl: null, mute: false, deaf: false, speaking: false });
  });
});

// ── Client ↔ fake pipe server integration ─────────────────────────────────────
// A REAL socket server on a platform-appropriate pipe path exercises the whole
// transport: handshake, nonce-matched request/response, ERROR rejection,
// dispatch fan-out, and teardown on server close.

/** Windows-only: \\?\pipe\ name; macOS/Linux-only: unix socket in tmpdir. */
function testPipePath(): string {
  const name = `dash-discord-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  return process.platform === 'win32'
    ? `\\\\?\\pipe\\${name}`
    : path.join(os.tmpdir(), `${name}.sock`);
}

interface FakePipe {
  server: net.Server;
  path: string;
  /** Push a FRAME payload to the (single) connected client. */
  dispatch: (payload: unknown) => void;
  close: () => Promise<void>;
}

/** Fake Discord: answers HANDSHAKE with READY and commands per `respond`. */
function startFakePipe(
  respond: (payload: { cmd?: string; nonce?: string; evt?: string; args?: Record<string, unknown> }) => unknown | undefined,
): Promise<FakePipe> {
  const pipePath = testPipePath();
  let conn: net.Socket | null = null;
  const server = net.createServer((socket) => {
    conn = socket;
    const dec = new RpcFrameDecoder();
    socket.on('data', (chunk) => {
      for (const frame of dec.push(chunk)) {
        if (frame.op === RPC_OP.HANDSHAKE) {
          socket.write(encodeRpcFrame(RPC_OP.FRAME, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 }, nonce: null }));
          continue;
        }
        if (frame.op !== RPC_OP.FRAME) continue;
        const payload = frame.payload as { cmd?: string; nonce?: string; evt?: string; args?: Record<string, unknown> };
        const out = respond(payload);
        if (out !== undefined) socket.write(encodeRpcFrame(RPC_OP.FRAME, out));
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, () => {
      resolve({
        server,
        path: pipePath,
        dispatch: (payload) => conn?.write(encodeRpcFrame(RPC_OP.FRAME, payload)),
        close: () =>
          new Promise<void>((res) => {
            conn?.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}

describe('DiscordRpcClient over a fake pipe', () => {
  let pipe: FakePipe | null = null;

  beforeEach(() => {
    vi.stubEnv('DISCORD_CLIENT_ID', 'test-client-id');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await pipe?.close();
    pipe = null;
  });

  it('handshakes (READY) and resolves nonce-matched command responses', async () => {
    pipe = await startFakePipe((p) => {
      if (p.cmd === 'GET_GUILDS') {
        return { cmd: 'GET_GUILDS', nonce: p.nonce, evt: null, data: { guilds: [{ id: 'g1', name: 'Guild One' }] } };
      }
      return undefined;
    });
    const client = new DiscordRpcClient({ paths: [pipe.path] });
    await client.connect();
    expect(client.isReady).toBe(true);
    const guilds = await client.getGuilds();
    expect(guilds).toEqual([{ id: 'g1', name: 'Guild One', iconUrl: null }]);
  });

  it('rejects a command answered with evt ERROR', async () => {
    pipe = await startFakePipe((p) => {
      if (p.cmd === 'SELECT_VOICE_CHANNEL') {
        return { cmd: p.cmd, nonce: p.nonce, evt: 'ERROR', data: { code: 5003, message: 'Already in voice' } };
      }
      return undefined;
    });
    const client = new DiscordRpcClient({ paths: [pipe.path] });
    await expect(client.selectVoiceChannel('123')).rejects.toThrow(/5003.*Already in voice/);
  });

  it('carries SUBSCRIBE evt names top-level and fans DISPATCH events out', async () => {
    const seen: Array<{ evt?: string; args?: Record<string, unknown> }> = [];
    pipe = await startFakePipe((p) => {
      if (p.cmd === 'SUBSCRIBE') {
        seen.push({ evt: p.evt, args: p.args });
        return { cmd: 'SUBSCRIBE', nonce: p.nonce, evt: null, data: { evt: p.evt } };
      }
      return undefined;
    });
    const client = new DiscordRpcClient({ paths: [pipe.path] });
    await client.subscribe('SPEAKING_START', { channel_id: 'c9' });
    expect(seen).toEqual([{ evt: 'SPEAKING_START', args: { channel_id: 'c9' } }]);

    const events: Array<[string, unknown]> = [];
    client.onDispatch((evt, data) => events.push([evt, data]));
    pipe.dispatch({ cmd: 'DISPATCH', evt: 'SPEAKING_START', data: { user_id: 'u1' }, nonce: null });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual(['SPEAKING_START', { user_id: 'u1' }]);
  });

  it('tears down on pipe close: onClose fires, pending requests reject, reconnectable state', async () => {
    pipe = await startFakePipe(() => undefined); // never answers commands
    const client = new DiscordRpcClient({ paths: [pipe.path] });
    await client.connect();
    let closed = 0;
    client.onClose(() => closed++);
    const hanging = client.getGuilds();
    await pipe.close();
    await expect(hanging).rejects.toThrow(/connection closed/);
    await vi.waitFor(() => expect(closed).toBe(1));
    expect(client.isReady).toBe(false);
    await expect(client.connect()).rejects.toThrow(/not running/);
  });

  it('throws DiscordUnavailableError when no pipe candidate is reachable', async () => {
    const client = new DiscordRpcClient({ paths: [testPipePath()] });
    await expect(client.connect()).rejects.toThrow(/not running/);
  });
});
