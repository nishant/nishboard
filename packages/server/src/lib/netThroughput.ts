import type { NetworkIo } from '@dash/shared';
import si from 'systeminformation';

// One shared network-throughput reader for the hardware and network routes.
// systeminformation computes rx_sec/tx_sec from module-level state (bytes since
// the previous networkStats() call by ANYONE, over the ms since that call
// finished), so two routes calling si.networkStats() independently give noisy
// rates. Everything goes through here instead: at most one si.networkStats()
// per CACHE_MS, and concurrent callers share the in-flight call.

const CACHE_MS = 1_000;

const LOOPBACK_IFACES = new Set(['lo', 'lo0', 'Loopback Pseudo-Interface 1']);

export function isRealIface(iface: string): boolean {
  if (LOOPBACK_IFACES.has(iface)) return false;
  if (iface.toLowerCase().startsWith('loopback')) return false;
  return true;
}

let cached: { at: number; value: NetworkIo[] } | null = null;
let inFlight: Promise<NetworkIo[]> | null = null;

async function sample(): Promise<NetworkIo[]> {
  const netStats = await si
    .networkStats()
    .catch(() => [] as si.Systeminformation.NetworkStatsData[]);
  // Sort most-active first so the primary interface leads; never filter by
  // traffic so the card stays visible when idle.
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

/** Filtered, Mbps-mapped interface throughput. Single-flight, cached for 1s. */
export function getNetThroughput(): Promise<NetworkIo[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
  inFlight ??= sample()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test helper: drop the cache and any in-flight call. */
export function resetNetThroughputForTests(): void {
  cached = null;
  inFlight = null;
}
