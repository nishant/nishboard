import { PsHost, buildBootstrap } from './psHost';

// Windows only. si.fsStats() always resolves null on Windows, so the aggregate
// disk throughput comes from the PhysicalDisk performance counters, read through
// a dedicated long-lived PowerShell (PsHost). The counters are created once per
// PowerShell process; a rate counter needs two samples, so the first read after
// creation may report 0.

const SNIPPET =
  "if (-not $global:DiskR) { $global:DiskR = New-Object System.Diagnostics.PerformanceCounter('PhysicalDisk','Disk Read Bytes/sec','_Total'); " +
  "$global:DiskW = New-Object System.Diagnostics.PerformanceCounter('PhysicalDisk','Disk Write Bytes/sec','_Total'); " +
  '[void]$global:DiskR.NextValue(); [void]$global:DiskW.NextValue() }; ' +
  "'{0} {1}' -f $global:DiskR.NextValue().ToString([Globalization.CultureInfo]::InvariantCulture), $global:DiskW.NextValue().ToString([Globalization.CultureInfo]::InvariantCulture)";

export type DiskRunner = (script: string) => Promise<string>;

export interface WinDiskIo {
  readMBs: number;
  writeMBs: number;
}

let host: PsHost | null = null;
const defaultRunner: DiskRunner = (script) => {
  host ??= new PsHost({ bootstrap: buildBootstrap() });
  return host.run(script);
};

function toMBs(bytesPerSec: number): number {
  return parseFloat((bytesPerSec / 1024 / 1024).toFixed(2));
}

/** Exported for tests. Parses "<readBytes/s> <writeBytes/s>" (invariant culture). */
export function parseDiskIo(out: string): WinDiskIo | null {
  const parts = out.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [r, w] = parts.map(Number);
  if (!Number.isFinite(r) || !Number.isFinite(w) || r < 0 || w < 0) return null;
  return { readMBs: toMBs(r), writeMBs: toMBs(w) };
}

/** Aggregate physical-disk throughput in MB/s, or null on any failure. */
export async function readWinDiskIo(run: DiskRunner = defaultRunner): Promise<WinDiskIo | null> {
  try {
    return parseDiskIo(await run(SNIPPET));
  } catch {
    return null;
  }
}
