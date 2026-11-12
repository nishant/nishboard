import type { FastifyPluginAsync } from 'fastify';
import type { NetworkMonitorData, PingHostStats } from '@dash/shared';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { HttpError } from '../lib/http';
import { getNetThroughput } from '../lib/netThroughput';

const execFileAsync = promisify(execFile);

const DEFAULT_HOSTS = ['1.1.1.1', '8.8.8.8'];
const MAX_HOSTS = 4;
const WINDOW = 30; // ring buffer — last 30 samples per host (~2.5min at the 5s tick)
const TICK_MS = 5_000;
const IDLE_STOP_MS = 60_000; // sampler self-stops when no GET has landed for this long
const PING_TIMEOUT_MS = 1_000; // ping's own reply timeout (-w / -W)
const EXEC_TIMEOUT_MS = 1_500; // belt-and-braces: kill the child if ping itself hangs

// ── Host validation ───────────────────────────────────────────────────────
// Hosts become argv for a spawned `ping` (no shell), so shell metacharacters
// are inert — but a leading `-` could still be parsed as a ping FLAG. The
// regex requires an alphanumeric first char; the startsWith('-') check is
// explicit belt-and-braces for that flag-injection class.

const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/;

/** Exported for tests. */
export function isValidHost(host: string): boolean {
  if (host.startsWith('-')) return false;
  return HOST_RE.test(host);
}

// ── Output parsing ────────────────────────────────────────────────────────

/** Exported for tests. Windows-only: `ping -n 1 -w 1000` output is LOCALIZED
 *  ("time=6ms" / "Zeit=14ms" / "temps=6 ms"…), so match the `=N<unit>` / `<N<unit>`
 *  token that precedes TTL= — never the word "time" or the unit. The `<1ms` form → 0.5. */
export function parseWinPing(stdout: string): number | null {
  // Anchor on the untranslated TTL token: the unit ("ms", "мс") and the word
  // for time are localized, "TTL=" is not.
  // IPv6 replies ("Reply from 2001:db8::1: time=12ms") carry NO TTL token, so fall
  // back to the first `=N<unit>` / `<N<unit>` token (a unit is required, which
  // excludes bare counters like "Bytes=32").
  const m =
    /([=<])\s*(\d+)\s?[^\s\d=<]*\s+TTL=/i.exec(stdout) ??
    /([=<])\s*(\d+)\s?[^\s\d=<]+/.exec(stdout);
  if (!m) return null;
  // `time<1ms` / `Zeit<1ms` — sub-millisecond reply, report the midpoint.
  if (m[1] === '<') return 0.5;
  return Number(m[2]);
}

/** Exported for tests. macOS-only: BSD ping prints `time=6.297 ms`. */
export function parseMacPing(stdout: string): number | null {
  const m = /time=([\d.]+) ms/.exec(stdout);
  return m ? Number(m[1]) : null;
}

/** One ping round-trip in ms, or null on loss. Loss is a VALUE here, not an
 *  error: non-zero exit, exec timeout, and unparseable output all mean "no
 *  reply within the window" — exactly what the loss stat measures. */
async function pingOnce(host: string): Promise<number | null> {
  try {
    if (process.platform === 'win32') {
      // Windows-only: -n 1 = one echo, -w = reply timeout in ms.
      const { stdout } = await execFileAsync(
        'ping',
        ['-n', '1', '-w', String(PING_TIMEOUT_MS), host],
        { timeout: EXEC_TIMEOUT_MS },
      );
      return parseWinPing(stdout);
    }
    // macOS-only: BSD ping, -c 1 = one echo, -W = reply timeout in ms.
    const { stdout } = await execFileAsync(
      'ping',
      ['-c', '1', '-W', String(PING_TIMEOUT_MS), host],
      { timeout: EXEC_TIMEOUT_MS },
    );
    return parseMacPing(stdout);
  } catch {
    return null; // loss — never throw from the sampler path
  }
}

// ── Window statistics ─────────────────────────────────────────────────────

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Pure stats over one host's ring buffer. Exported for tests. */
export function computeStats(buffer: ReadonlyArray<number | null>): Omit<PingHostStats, 'host' | 'recentMs'> {
  const samples = buffer.length;
  const ok = buffer.filter((v): v is number => v !== null);

  const latest = samples > 0 ? buffer[samples - 1] : null;
  const avg = ok.length > 0 ? ok.reduce((s, v) => s + v, 0) / ok.length : null;

  // Jitter = mean |successive diff| between consecutive SUCCESSFUL samples.
  let jitter: number | null = null;
  if (ok.length >= 2) {
    let sum = 0;
    for (let i = 1; i < ok.length; i++) sum += Math.abs(ok[i] - ok[i - 1]);
    jitter = sum / (ok.length - 1);
  }

  return {
    latestMs: latest === null ? null : round1(latest),
    avgMs: avg === null ? null : round1(avg),
    jitterMs: jitter === null ? null : round1(jitter),
    lossPct: samples > 0 ? round1(((samples - ok.length) / samples) * 100) : 0,
    samples,
  };
}

// ── Sampler ───────────────────────────────────────────────────────────────
// Module-level background sampler — pings run on a 5s tick, NOT per request,
// so four widget polls a second add no extra pings (the interface throughput
// read is separate: lib/netThroughput.ts, shared and cached for 1s). Lazy
// lifecycle: the first GET starts it; each tick self-stops (and clears the
// buffers) once no request has landed for IDLE_STOP_MS. Buffers are kept PER
// HOST, so editing one target keeps the other host's history; a host nobody has
// asked for within IDLE_STOP_MS is dropped on the next tick.

interface HostBuf {
  buf: Array<number | null>;
  lastSeen: number;
}

/** One round-trip in ms, or null on loss. Injectable so tests need no child process. */
export type PingFn = (host: string) => Promise<number | null>;

/** Exported for tests. */
export class Sampler {
  constructor(private readonly ping: PingFn = pingOnce) {}

  private hosts = new Map<string, HostBuf>();
  private timer: NodeJS.Timeout | null = null;
  private lastRequestAt = 0;
  private ticking = false;

  /** Bump the keep-alive clock, register any new hosts, start the tick. */
  touch(hosts: string[]): void {
    const now = Date.now();
    this.lastRequestAt = now;
    for (const h of hosts) {
      const entry = this.hosts.get(h);
      if (entry) entry.lastSeen = now;
      else this.hosts.set(h, { buf: [], lastSeen: now });
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      this.timer.unref(); // never hold the server process open for pings
      void this.tick(); // prime immediately so the first poll isn't empty-handed
    }
  }

  read(hosts: string[]): PingHostStats[] {
    return hosts.map((h) => {
      const buf = this.hosts.get(h)?.buf ?? [];
      return { host: h, ...computeStats(buf), recentMs: buf.map((v) => (v === null ? null : round1(v))) };
    });
  }

  /** Stop the timer and clear all history. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.hosts = new Map();
  }

  /** One sampling round (public so tests can drive it). */
  async tick(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRequestAt > IDLE_STOP_MS) {
      this.stop();
      return;
    }
    // Drop hosts no request has named recently.
    for (const [h, e] of this.hosts) {
      if (now - e.lastSeen > IDLE_STOP_MS) this.hosts.delete(h);
    }
    if (this.ticking) return; // a slow ping batch must never overlap the next tick
    this.ticking = true;
    try {
      const hosts = [...this.hosts.keys()];
      const results = await Promise.allSettled(hosts.map((h) => this.ping(h)));
      hosts.forEach((h, i) => {
        const entry = this.hosts.get(h);
        if (!entry) return; // dropped mid-tick — discard the stale result
        const r = results[i];
        entry.buf.push(r.status === 'fulfilled' ? r.value : null);
        if (entry.buf.length > WINDOW) entry.buf.shift();
      });
    } finally {
      this.ticking = false;
    }
  }
}

const sampler = new Sampler();

// ── Route ─────────────────────────────────────────────────────────────────

export const networkRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { hosts?: string }; Reply: NetworkMonitorData | { error: string } }>(
    '/',
    {
      // A repeated ?hosts=a&hosts=b is an array; the schema turns it into a 400.
      schema: { querystring: { type: 'object', properties: { hosts: { type: 'string', maxLength: 1100 } } } },
    },
    async (req, reply) => {
      const parsed = (req.query.hosts ?? DEFAULT_HOSTS.join(','))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      // Two identical targets are one host: dedupe so the sampler tracks it once.
      const hosts = [...new Set(parsed)];
      if (hosts.length === 0) throw new HttpError(400, 'No hosts provided');
      if (hosts.length > MAX_HOSTS) throw new HttpError(400, `At most ${MAX_HOSTS} hosts`);
      // Validate BEFORE anything reaches the sampler (→ ping argv).
      for (const h of hosts) {
        if (!isValidHost(h)) throw new HttpError(400, `Invalid host: ${h}`);
      }

      sampler.touch(hosts);

      const ifaces = await getNetThroughput();
      const totals = {
        upMbps: round1(ifaces.reduce((s, n) => s + n.uploadMbps, 0)),
        downMbps: round1(ifaces.reduce((s, n) => s + n.downloadMbps, 0)),
      };

      return reply.send({
        hosts: sampler.read(hosts),
        totals,
        ifaces,
        tickMs: TICK_MS,
        windowSeconds: (WINDOW * TICK_MS) / 1000,
        fetchedAt: new Date().toISOString(),
      });
    },
  );
};
