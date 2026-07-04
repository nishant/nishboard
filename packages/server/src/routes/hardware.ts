import type { FastifyPluginAsync } from 'fastify';
import type { HardwareData, CpuData, GpuData, DiskIo, DiskUsage, NetworkIo, ProcessListData, ProcessItemData } from '@dash/shared';
import si from 'systeminformation';
import os from 'os';
import { SimpleCache } from '../cache/SimpleCache';

const cache = new SimpleCache<HardwareData>();
// 900ms TTL — renderer polls every 1s, prevents duplicate work if two requests land close together
const TTL_MS = 900;

// Slow-changing subsystems don't need re-querying every second:
// - fsSize (disk usage) shells out per mount and moves on the order of minutes
// - battery percent moves on the order of minutes
// - graphics on macOS shells out to system_profiler AND reports no live GPU
//   utilization anyway; on Windows nvidia-smi carries live utilization, so it
//   must stay on the 1s path there
const fsSizeCache = new SimpleCache<si.Systeminformation.FsSizeData[]>();
// Boxed: SimpleCache uses null for "miss", and a failed battery query is a
// legitimate cached value — without the box it would re-query every second.
const batteryCache = new SimpleCache<{ value: si.Systeminformation.BatteryData | null }>();
const graphicsCache = new SimpleCache<si.Systeminformation.GraphicsData>();
const FS_SIZE_TTL = 60_000;
const BATTERY_TTL = 30_000;
const GRAPHICS_TTL_DARWIN = 10_000;

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

async function getGraphics(): Promise<si.Systeminformation.GraphicsData> {
  if (process.platform !== 'darwin') {
    return si.graphics().catch(() => ({ controllers: [], displays: [] }));
  }
  const cached = graphicsCache.get();
  if (cached) return cached;
  const data = await si.graphics().catch(() => ({ controllers: [], displays: [] }));
  graphicsCache.set(data, GRAPHICS_TTL_DARWIN);
  return data;
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

const LOOPBACK_IFACES = new Set(['lo', 'lo0', 'Loopback Pseudo-Interface 1']);

function isRealIface(iface: string): boolean {
  if (LOOPBACK_IFACES.has(iface)) return false;
  if (iface.toLowerCase().startsWith('loopback')) return false;
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
    netStats,
    batteryInfo,
  ] = await Promise.all([
    getStaticCpu(),
    si.currentLoad(),
    si.cpuTemperature().catch(() => null),
    getGraphics(),
    si.mem(),
    si.fsStats().catch(() => null),
    getFsSize(),
    si.networkStats().catch(() => [] as si.Systeminformation.NetworkStatsData[]),
    getBattery(),
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
  const disks: DiskIo[] = [
    {
      name: 'Total',
      readMBs: fsStats ? parseFloat(((fsStats.rx_sec ?? 0) / 1024 / 1024).toFixed(2)) : 0,
      writeMBs: fsStats ? parseFloat(((fsStats.wx_sec ?? 0) / 1024 / 1024).toFixed(2)) : 0,
    },
  ];

  // ── Disk usage (per mount) ────────────────────────────────────────────
  const diskUsage: DiskUsage[] = (fsSize as si.Systeminformation.FsSizeData[])
    .filter(isUsefulFs)
    .map((f) => ({
      mount: f.mount,
      usedGb: parseFloat((f.used / 1024 / 1024 / 1024).toFixed(1)),
      totalGb: parseFloat((f.size / 1024 / 1024 / 1024).toFixed(1)),
      usePercent: Math.round(f.use),
    }))
    .slice(0, 6); // cap at 6 entries

  // ── Network ───────────────────────────────────────────────────────────
  // Sort most-active first so primary interface leads; never filter by traffic
  // so the card stays visible even when idle.
  const network: NetworkIo[] = (netStats as si.Systeminformation.NetworkStatsData[])
    .filter((n) => isRealIface(n.iface) && n.operstate !== 'down')
    .sort((a, b) => (b.rx_sec + b.tx_sec) - (a.rx_sec + a.tx_sec))
    .slice(0, 3)
    .map((n) => ({
      iface: n.iface,
      uploadMbps: parseFloat(((n.tx_sec ?? 0) * 8 / 1_000_000).toFixed(2)),
      downloadMbps: parseFloat(((n.rx_sec ?? 0) * 8 / 1_000_000).toFixed(2)),
    }));

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

export const hardwareRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: HardwareData | { error: string } }>('/', async (_req, reply) => {
    const cached = cache.get();
    if (cached) return reply.send(cached);
    const data = await buildHardwareData();
    cache.set(data, TTL_MS);
    return reply.send(data);
  });

  fastify.get<{ Reply: ProcessListData | { error: string } }>('/processes', async (_req, reply) => {
    const cached = processCache.get();
    if (cached) return reply.send(cached);
    const data = await buildProcessList();
    processCache.set(data, PROCESS_TTL);
    return reply.send(data);
  });
};
