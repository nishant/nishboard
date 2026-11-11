import type { NetworkIo } from './hardware';

/** Rolling ping statistics for one monitored host (30-sample window; the tick is `NetworkMonitorData.tickMs`). */
export interface PingHostStats {
  host: string;
  /** Most recent round-trip in ms — null when the latest ping was lost. */
  latestMs: number | null;
  /** Mean over successful samples in the window — null when none succeeded. */
  avgMs: number | null;
  /** Mean |successive diff| over successful samples — null when <2 successes. */
  jitterMs: number | null;
  /** Lost samples as a percentage of the window. */
  lossPct: number;
  /** Samples collected so far (fills up to the 30-sample window). */
  samples: number;
  /** The window's samples, oldest first (null = lost ping), for the sparkline. */
  recentMs: (number | null)[];
}

export interface NetworkMonitorData {
  hosts: PingHostStats[];
  /** Mbps of the default interface only (systeminformation's networkStats() with no
   *  argument); other adapters (second NIC, VPN) are not counted. */
  totals: { upMbps: number; downMbps: number };
  /** Default interface only (see `totals`). */
  ifaces: NetworkIo[];
  /** Milliseconds between server pings. */
  tickMs: number;
  /** Seconds of history the stats and `recentMs` cover (window samples x tick). */
  windowSeconds: number;
  fetchedAt: string;
}
