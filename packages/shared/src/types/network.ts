import type { NetworkIo } from './hardware';

/** Rolling ping statistics for one monitored host (30-sample window, 2s tick). */
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
}

export interface NetworkMonitorData {
  hosts: PingHostStats[];
  /** Summed Mbps across active interfaces (same math as hardware's NetworkIo). */
  totals: { upMbps: number; downMbps: number };
  ifaces: NetworkIo[];
  fetchedAt: string;
}
