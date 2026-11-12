import type { FastifyPluginAsync } from 'fastify';
import type { HardwareData, CpuData, GpuData, DiskIo, DiskUsage, ProcessListData, ProcessItemData } from '@dash/shared';
import si from 'systeminformation';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { SimpleCache } from '../cache/SimpleCache';
import { getNetThroughput } from '../lib/netThroughput';
import { readWinDiskIo } from '../lib/winDiskIo';

const execFileAsync = promisify(execFile);

const cache = new SimpleCache<HardwareData>();
// 900ms TTL — renderer polls every 1s, prevents duplicate work if two requests land close together
const TTL_MS = 900;

// Slow-changing subsystems don't need re-querying every second:
// - fsSize (disk usage) shells out per mount and moves on the order of minutes
// - battery percent moves on the order of minutes
// - graphics: si.graphics() is expensive (Windows: 8 PowerShell spawns plus a
//   synchronous nvidia-smi inside systeminformation) and the controller list is
//   static, so it is cached (10 min on Windows/Linux, 10s on macOS where it
//   shells out to system_profiler and reports no live utilization anyway).
//   Windows-only: live GPU utilization/VRAM/temp/clock come from a separate
//   async nvidia-smi query, see getNvidiaLive().
// - cpuTemperature and swap (si.mem fields) change slowly: cached 30s
const fsSizeCache = new SimpleCache<si.Systeminformation.FsSizeData[]>();
// Boxed: SimpleCache uses null for "miss", and a failed battery query is a
// legitimate cached value — without the box it would re-query every second.
const batteryCache = new SimpleCache<{ value: si.Systeminformation.BatteryData | null }>();
const graphicsCache = new SimpleCache<si.Systeminformation.GraphicsData>();
const FS_SIZE_TTL = 60_000;
const BATTERY_TTL = 30_000;
const GRAPHICS_TTL_DARWIN = 10_000;
const GRAPHICS_TTL_STATIC = 10 * 60_000; // Windows/Linux: static controller info
const SLOW_TTL = 30_000; // cpuTemperature + swap
const NVIDIA_MIN_INTERVAL_MS = 2_000;
const NVIDIA_FAIL_BACKOFF_MS = 60_000; // nvidia-smi missing/failing: don't respawn every 2s

async function getFsSize(): Promise<si.Systeminformation.FsSizeData[]> {
  const cached = fsSizeCache.get();
  if (cached) return cached;
  const data = await si.fsSize().catch(() => [] as si.Systeminformation.FsSizeData[]);
  fsSizeCache.set(data, FS_SIZE_TTL);
  return data;
}

async function getBattery(): Promise<si.Systeminformation.BatteryData | null> {
  const cached = batteryCache.get();
  if (cached) return cached.value;
  const value = await si.battery().catch(() => null);
  batteryCache.set({ value }, BATTERY_TTL);
  return value;
}

export interface NvidiaLive {
  utilizationGpu: number;
  memoryUsed: number;
  memoryTotal: number;
  temperatureGpu: number;
  clockCore: number;
}

/** Exported for tests. Parses the first line of
 *  `nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.gr --format=csv,noheader,nounits`
 *  (percent, MiB, MiB, deg C, MHz). Null when the line is unusable. */
export function parseNvidiaSmi(stdout: string): NvidiaLive | null {
  const line = stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!line) return null;
  const n = line.split(',').map((x) => Number(x.trim()));
  if (n.length < 5) return null;
  const [utilizationGpu, memoryUsed, memoryTotal, temperatureGpu, clockCore] = n;
  // "[N/A]" fields become NaN: treat the whole sample as unusable.
  if ([utilizationGpu, memoryUsed, memoryTotal, temperatureGpu, clockCore].some((v) => !Number.isFinite(v))) return null;
  return { utilizationGpu, memoryUsed, memoryTotal, temperatureGpu, clockCore };
}

// Windows-only: live NVIDIA stats. Async execFile (never execSync on the event
// loop), single-flight, at most one spawn per NVIDIA_MIN_INTERVAL_MS. On failure
// the last good sample (or null, i.e. the cached si values) is kept.
let nvidiaLive: NvidiaLive | null = null;
let nvidiaCheckedAt = 0;
let nvidiaBackoffUntil = 0;
let nvidiaInFlight: Promise<void> | null = null;

async function getNvidiaLive(): Promise<NvidiaLive | null> {
  const now = Date.now();
  if (nvidiaInFlight) {
    await nvidiaInFlight;
    return nvidiaLive;
  }
  if (now < nvidiaBackoffUntil || now - nvidiaCheckedAt < NVIDIA_MIN_INTERVAL_MS) return nvidiaLive;
  nvidiaCheckedAt = now;
  nvidiaInFlight = (async () => {
    try {
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        [
          '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.gr',
          '--format=csv,noheader,nounits',
        ],
        { timeout: 3000, windowsHide: true },
      );
      const parsed = parseNvidiaSmi(String(stdout));
      if (parsed) nvidiaLive = parsed;
    } catch {
      nvidiaBackoffUntil = Date.now() + NVIDIA_FAIL_BACKOFF_MS;
    }
  })().finally(() => {
    nvidiaInFlight = null;
  });
  await nvidiaInFlight;
  return nvidiaLive;
}

/** Exported for tests. Overlays live nvidia-smi values on the NVIDIA controller. */
export function applyNvidiaLive(
  controllers: si.Systeminformation.GraphicsControllerData[],
  live: NvidiaLive | null,
): si.Systeminformation.GraphicsControllerData[] {
  if (!live) return controllers;
  const idx = controllers.findIndex((c) => /nvidia/i.test(`${c.vendor ?? ''} ${c.model ?? ''}`));
  if (idx < 0) return controllers;
  const out = [...controllers];
  out[idx] = {
    ...out[idx],
    utilizationGpu: live.utilizationGpu,
    memoryUsed: live.memoryUsed,
    memoryTotal: live.memoryTotal,
    temperatureGpu: live.temperatureGpu,
    clockCore: live.clockCore,
  };
  return out;
}

async function getGraphics(): Promise<si.Systeminformation.GraphicsData> {
  let data = graphicsCache.get();
  if (!data) {
    data = await si.graphics().catch(() => ({ controllers: [], displays: [] }));
    // macOS-only short TTL (no live data there); 10 min elsewhere (static info).
    graphicsCache.set(data, process.platform === 'darwin' ? GRAPHICS_TTL_DARWIN : GRAPHICS_TTL_STATIC);
  }
  if (process.platform === 'win32') {
    // Windows-only: layer live nvidia-smi values over the cached controller list.
    const live = await getNvidiaLive();
    return { ...data, controllers: applyNvidiaLive(data.controllers ?? [], live) };
  }
  return data;
}

const cpuTempCache = new SimpleCache<{ value: si.Systeminformation.CpuTemperatureData | null }>();
async function getCpuTemp(): Promise<si.Systeminformation.CpuTemperatureData | null> {
  const cached = cpuTempCache.get();
  if (cached) return cached.value;
  const value = await si.cpuTemperature().catch(() => null);
  cpuTempCache.set({ value }, SLOW_TTL);
  return value;
}

const swapCache = new SimpleCache<{ swapused: number; swaptotal: number }>();
interface MemSample {
  total: number;
  active: number;
  used: number;
  swapused: number;
  swaptotal: number;
}
async function getMem(): Promise<MemSample> {
  if (process.platform === 'win32') {
    // Windows-only: si.mem() costs a PowerShell call (Win32_PageFileUsage), so
    // total/used come live from `os` and only swap comes from si.mem(), cached 30s.
    let swap = swapCache.get();
    if (!swap) {
      const m = await si.mem().catch(() => null);
      swap = { swapused: m?.swapused ?? 0, swaptotal: m?.swaptotal ?? 0 };
      swapCache.set(swap, SLOW_TTL);
    }
    const total = os.totalmem();
    const used = total - os.freemem();
    return { total, active: used, used, ...swap };
  }
  // macOS/Linux: si.mem() is a cheap sysctl/proc read and `active` needs it.
  const m = await si.mem();
  return { total: m.total, active: m.active, used: m.used, swapused: m.swapused, swaptotal: m.swaptotal };
}

// CPU brand/core count/speed never changes at runtime — fetch once
let staticCpu: { brand: string; cores: number; physicalCores: number; speedGhz: number } | null = null;
async function getStaticCpu() {
  if (staticCpu) return staticCpu;
  const c = await si.cpu();
  staticCpu = { brand: c.brand, cores: c.cores, physicalCores: c.physicalCores, speedGhz: c.speed ?? 0 };
  return staticCpu;
}

function pickGpu(controllers: si.Systeminformation.GraphicsControllerData[]): GpuData | null {
  if (controllers.length === 0) return null;

  // Prefer the controller with most VRAM (dGPU > iGPU on desktop/gaming)
  const sorted = [...controllers].sort((a, b) => (b.vram ?? 0) - (a.vram ?? 0));
  const ctrl = sorted[0];

  // Skip truly empty entries (no vendor, no model)
  if (!ctrl.vendor && !ctrl.model) return null;

  const vramTotal = ctrl.vramDynamic
    ? 0 // Apple unified memory — dynamic, not fixed
    : (ctrl.memoryTotal ?? ctrl.vram ?? 0);

  const vramUsed = ctrl.memoryUsed ?? 0;

  return {
    name: ctrl.model || ctrl.vendor || 'GPU',
    usagePercent: ctrl.utilizationGpu ?? 0,
    vramUsedMb: vramUsed,
    vramTotalMb: vramTotal,
    tempCelsius: ctrl.temperatureGpu && ctrl.temperatureGpu > 0 ? ctrl.temperatureGpu : null,
    clockMhz: ctrl.clockCore && ctrl.clockCore > 0 ? ctrl.clockCore : null,
  };
}

// Virtual / snap filesystems to exclude from disk usage
const SKIP_FS_TYPES = new Set(['squashfs', 'tmpfs', 'devtmpfs', 'overlay', 'nsfs', 'efivarfs']);
const SKIP_MOUNT_PREFIXES = ['/boot', '/sys', '/proc', '/dev', '/run', '/snap', '/System/Volumes/'];

function isUsefulFs(fs: si.Systeminformation.FsSizeData): boolean {
  if (SKIP_FS_TYPES.has(fs.type)) return false;
  if (SKIP_MOUNT_PREFIXES.some((p) => fs.mount.startsWith(p))) return false;
  if (fs.size <= 0) return false;
  return true;
}

async function buildHardwareData(): Promise<HardwareData> {
  const [
    cpuStatic,
    currentLoad,
    cpuTemp,
    graphics,
    mem,
    fsStats,
    fsSize,
    network,
    batteryInfo,
    winDisk,
  ] = await Promise.all([
    getStaticCpu(),
    si.currentLoad(),
    getCpuTemp(),
    getGraphics(),
    getMem(),
    si.fsStats().catch(() => null),
    getFsSize(),
    getNetThroughput(),
    getBattery(),
    // Windows-only: si.fsStats() is null there, read the PhysicalDisk counters instead.
    process.platform === 'win32' ? readWinDiskIo() : Promise.resolve(null),
  ]);

  // ── CPU ────────────────────────────────────────────────────────────────
  const cpu: CpuData = {
    brand: cpuStatic.brand,
    cores: cpuStatic.cores,
    physicalCores: cpuStatic.physicalCores,
    usagePercent: Math.round(currentLoad.currentLoad),
    coreUsage: (currentLoad.cpus ?? []).map((c) => Math.round(c.load)),
    speedGhz: cpuStatic.speedGhz,
    tempCelsius: cpuTemp && cpuTemp.main > 0 ? Math.round(cpuTemp.main) : null,
  };

  // ── GPU ───────────────────────────────────────────────────────────────
  const gpu = pickGpu(graphics.controllers ?? []);

  // ── RAM ───────────────────────────────────────────────────────────────
  // Use active (actually in use) rather than used (includes buffers/cache) for macOS accuracy
  const ramActive = mem.active > 0 ? mem.active : mem.used;
  const ram = {
    usedMb: Math.round(ramActive / 1024 / 1024),
    totalMb: Math.round(mem.total / 1024 / 1024),
    usagePercent: Math.round((ramActive / mem.total) * 100),
    swapUsedMb: Math.round((mem.swapused ?? 0) / 1024 / 1024),
    swapTotalMb: Math.round((mem.swaptotal ?? 0) / 1024 / 1024),
  };

  // ── Disk I/O (aggregate via fsStats — bytes/sec) ─────────────────────
  // Windows: si.fsStats() always resolves null, so the totals come from the
  // PhysicalDisk perf counters (lib/winDiskIo; the first sample may read 0).
  // If those fail too, send no entry (the widget hides the I/O row) instead of
  // a fake 0 MB/s.
  const disks: DiskIo[] = fsStats
    ? [
        {
          name: 'Total',
          readMBs: parseFloat(((fsStats.rx_sec ?? 0) / 1024 / 1024).toFixed(2)),
          writeMBs: parseFloat(((fsStats.wx_sec ?? 0) / 1024 / 1024).toFixed(2)),
        },
      ]
    : winDisk
      ? [{ name: 'Total', readMBs: winDisk.readMBs, writeMBs: winDisk.writeMBs }]
      : [];

  // ── Disk usage (per mount) ────────────────────────────────────────────
  const diskUsage: DiskUsage[] = fsSize
    .filter(isUsefulFs)
    .map((f) => ({
      mount: f.mount,
      usedGb: parseFloat((f.used / 1024 / 1024 / 1024).toFixed(1)),
      totalGb: parseFloat((f.size / 1024 / 1024 / 1024).toFixed(1)),
      usePercent: Math.round(f.use),
    }))
    .slice(0, 6); // cap at 6 entries

  // ── Network ───────────────────────────────────────────────────────────
  // Filtered, sorted and mapped in lib/netThroughput (shared with the Net Monitor).

  // ── Battery ───────────────────────────────────────────────────────────
  let battery: HardwareData['battery'] = null;
  if (batteryInfo?.hasBattery) {
    battery = {
      percent: Math.round(batteryInfo.percent),
      charging: batteryInfo.isCharging,
    };
  }

  return {
    cpu,
    gpu,
    ram,
    disks,
    diskUsage,
    network,
    uptime: Math.floor(os.uptime()),
    battery,
    fetchedAt: new Date().toISOString(),
  };
}

// ── Top processes ─────────────────────────────────────────────────────────
// si.processes() is cheap on macOS (`ps`) but expensive on Windows (PowerShell
// CIM, hundreds of ms) — hence the 5s renderer poll with a 4.5s cache, and the
// renderer only polls while the panel is open. Windows caveat: CPU% is
// delta-based, so the very first sample reports 0 for every process.
const processCache = new SimpleCache<ProcessListData>();
const PROCESS_TTL = 4_500;

async function buildProcessList(): Promise<ProcessListData> {
  const procs = await si.processes();
  // Group by name (chrome × 14 …) — summed CPU/RSS reads like Task Manager's
  // grouped view and keeps the list stable across per-tab process churn.
  const byName = new Map<string, ProcessItemData>();
  for (const p of procs.list) {
    if (!p.name) continue;
    const row = byName.get(p.name);
    const memMb = (p.memRss ?? 0) / 1024; // memRss is KB
    if (row) {
      row.count += 1;
      row.cpuPercent += p.cpu ?? 0;
      row.memMb += memMb;
      row.memPercent += p.mem ?? 0;
    } else {
      byName.set(p.name, {
        name: p.name,
        count: 1,
        cpuPercent: p.cpu ?? 0,
        memMb,
        memPercent: p.mem ?? 0,
      });
    }
  }
  const all = [...byName.values()];
  // Union of top-20 by CPU and top-20 by RAM so the renderer can sort by
  // either without another round-trip.
  const topCpu = [...all].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 20);
  const topMem = [...all].sort((a, b) => b.memMb - a.memMb).slice(0, 20);
  const union = [...new Set([...topCpu, ...topMem])].map((p) => ({
    ...p,
    cpuPercent: Math.round(p.cpuPercent * 10) / 10,
    memMb: Math.round(p.memMb),
    memPercent: Math.round(p.memPercent * 10) / 10,
  }));
  return { processes: union, fetchedAt: new Date().toISOString() };
}

let hardwareInFlight: Promise<HardwareData> | null = null;
let processInFlight: Promise<ProcessListData> | null = null;

export const hardwareRoutes: FastifyPluginAsync = async (fastify) => {
  // Windows-only: keep ONE persistent PowerShell for systeminformation's
  // remaining Windows calls instead of a fresh powershell.exe per call.
  if (process.platform === 'win32') {
    try {
      si.powerShellStart();
      fastify.addHook('onClose', async () => {
        try {
          si.powerShellRelease();
        } catch {
          /* already released */
        }
      });
    } catch {
      /* fall back to non-persistent mode */
    }
  }

  fastify.get<{ Reply: HardwareData | { error: string } }>('/', async (_req, reply) => {
    const cached = cache.get();
    if (cached) return reply.send(cached);
    // Single-flight: concurrent requests share one build.
    hardwareInFlight ??= buildHardwareData()
      .then((d) => {
        cache.set(d, TTL_MS);
        return d;
      })
      .finally(() => {
        hardwareInFlight = null;
      });
    return reply.send(await hardwareInFlight);
  });

  fastify.get<{ Reply: ProcessListData | { error: string } }>('/processes', async (_req, reply) => {
    const cached = processCache.get();
    if (cached) return reply.send(cached);
    processInFlight ??= buildProcessList()
      .then((d) => {
        processCache.set(d, PROCESS_TTL);
        return d;
      })
      .finally(() => {
        processInFlight = null;
      });
    return reply.send(await processInFlight);
  });
};
