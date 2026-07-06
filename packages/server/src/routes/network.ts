import type { FastifyPluginAsync } from 'fastify';
import type { NetworkMonitorData, PingHostStats, NetworkIo } from '@dash/shared';
import { execFile } from 'child_process';
import { promisify } from 'util';
import si from 'systeminformation';
import { HttpError } from '../lib/http';

const execFileAsync = promisify(execFile);

const DEFAULT_HOSTS = ['1.1.1.1', '8.8.8.8'];
const MAX_HOSTS = 4;
const WINDOW = 30; // ring buffer — last 30 samples per host (~1min at the 2s tick)
const TICK_MS = 2_000;
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
 *  ("time=6ms" / "Zeit=14ms" / "temps=6 ms"…), so match the `=Nms` / `<Nms`
 *  token shape — never the word "time". The `<1ms` form → 0.5. */
export function parseWinPing(stdout: string): number | null {
  const m = /([=<])\s*(\d+)\s*ms/.exec(stdout);
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
export function computeStats(buffer: ReadonlyArray<number | null>): Omit<PingHostStats, 'host'> {
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
// Module-level background sampler — pings run on a 2s tick, NOT per request,
// so four widget polls a second cost zero extra child processes. Lazy
// lifecycle: the first GET starts it; each tick self-stops (and clears the
// buffers) once no request has landed for IDLE_STOP_MS.

class Sampler {
  private buffers = new Map<string, Array<number | null>>();
  private timer: NodeJS.Timeout | null = null;
  private lastRequestAt = 0;
  private ticking = false;

  /** Bump the keep-alive clock, swap buffers on a host-set change, start the tick. */
  touch(hosts: string[]): void {
    this.lastRequestAt = Date.now();
    if ([...this.buffers.keys()].join(',') !== hosts.join(',')) {
      this.buffers = new Map(hosts.map((h) => [h, []]));
    }
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      this.timer.unref(); // never hold the server process open for pings
      void this.tick(); // prime immediately so the first poll isn't empty-handed
    }
  }

  read(hosts: string[]): PingHostStats[] {
    return hosts.map((h) => ({ host: h, ...computeStats(this.buffers.get(h) ?? []) }));
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.buffers = new Map();
  }

  private async tick(): Promise<void> {
    if (Date.now() - this.lastRequestAt > IDLE_STOP_MS) {
      this.stop();
      return;
    }
    if (this.ticking) return; // a slow ping batch must never overlap the next tick
    this.ticking = true;
    try {
      const hosts = [...this.buffers.keys()];
      const results = await Promise.allSettled(hosts.map((h) => pingOnce(h)));
      hosts.forEach((h, i) => {
        const r = results[i];
        const buf = this.buffers.get(h);
        if (!buf) return; // host set swapped mid-tick — drop the stale result
        buf.push(r.status === 'fulfilled' ? r.value : null);
        if (buf.length > WINDOW) buf.shift();
      });
    } finally {
      this.ticking = false;
    }
  }
}

const sampler = new Sampler();

// ── Interface throughput ──────────────────────────────────────────────────
// Same filter + Mbps math as hardware.ts's network section (bytes/s × 8 / 1e6).

const LOOPBACK_IFACES = new Set(['lo', 'lo0', 'Loopback Pseudo-Interface 1']);

function isRealIface(iface: string): boolean {
  if (LOOPBACK_IFACES.has(iface)) return false;
  if (iface.toLowerCase().startsWith('loopback')) return false;
  return true;
}

async function getIfaces(): Promise<NetworkIo[]> {
  const netStats = await si
    .networkStats()
    .catch(() => [] as si.Systeminformation.NetworkStatsData[]);
  return netStats
    .filter((n) => isRealIface(n.iface) && n.operstate !== 'down')
    .sort((a, b) => (b.rx_sec + b.tx_sec) - (a.rx_sec + a.tx_sec))
    .slice(0, 3)
    .map((n) => ({
      iface: n.iface,
      uploadMbps: parseFloat((((n.tx_sec ?? 0) * 8) / 1_000_000).toFixed(2)),
      downloadMbps: parseFloat((((n.rx_sec ?? 0) * 8) / 1_000_000).toFixed(2)),
    }));
}

// ── Route ─────────────────────────────────────────────────────────────────

export const networkRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { hosts?: string }; Reply: NetworkMonitorData | { error: string } }>(
    '/',
    async (req, reply) => {
      const hosts = (req.query.hosts ?? DEFAULT_HOSTS.join(','))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (hosts.length === 0) throw new HttpError(400, 'No hosts provided');
      if (hosts.length > MAX_HOSTS) throw new HttpError(400, `At most ${MAX_HOSTS} hosts`);
      // Validate BEFORE anything reaches the sampler (→ ping argv).
      for (const h of hosts) {
        if (!isValidHost(h)) throw new HttpError(400, `Invalid host: ${h}`);
      }

      sampler.touch(hosts);

      const ifaces = await getIfaces();
      const totals = {
        upMbps: round1(ifaces.reduce((s, n) => s + n.uploadMbps, 0)),
        downMbps: round1(ifaces.reduce((s, n) => s + n.downloadMbps, 0)),
      };

      return reply.send({
        hosts: sampler.read(hosts),
        totals,
        ifaces,
        fetchedAt: new Date().toISOString(),
      });
    },
  );
};
