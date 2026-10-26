import { memo } from 'react';
import { Cpu, Thermometer, HardDrive, Wifi, Battery, BatteryCharging, BarChart2, Activity, Settings, ListTree } from 'lucide-react';
import { useHardware, useProcesses, type HardwareHistory } from './useHardware';
import { useHardwareStore, type HardwareSection } from '../../store/hardwareStore';
import { useHardwareUiStore } from '../../store/hardwareUiStore';
import type { HardwareViewMode, ProcessSort } from '../../store/hardwareUiStore';
import { ErrorState } from '../../components/ErrorState';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';
import { useDragScroll } from '../../hooks/useDragScroll';
import { fmtUptime } from '../../lib/time';
import type { HardwareData } from '@dash/shared';
import { Card, Checkbox, Meter, Segmented, SkeletonLines, Sparkline, Spinner, cn, type MeterTone, type SparklineTone, Label } from '@nish/ui';
import { METER_NEUTRAL } from '../../components/nishGaps';

// ── Helpers ──────────────────────────────────────────────────────────────

function fmt(n: number, dec = 1): string {
  return n.toFixed(dec);
}

function tempColor(c: number | null): string {
  if (c === null) return 'text-th-hi3';
  if (c >= 85) return 'text-th-loss';
  if (c >= 70) return 'text-th-warn';
  return 'text-th-ok';
}

type ViewMode = HardwareViewMode;

// ── Sparkline ────────────────────────────────────────────────────────────

/** History sparkline anchored at zero like the old Recharts area; `max` pins
 *  percentages to 0–100. An all-zero series sits on the baseline. */
function Spark({ data, tone, label, max }: { data: number[]; tone: SparklineTone; label: string; max?: number }) {
  return (
    <Sparkline
      values={data}
      label={label}
      tone={tone}
      height={32}
      min={0}
      max={max ?? Math.max(1, ...data)}
      fill
      className="w-full"
    />
  );
}

// ── Usage bar ────────────────────────────────────────────────────────────

function UsageBar({ pct, tone, label, className }: { pct: number; tone: MeterTone; label: string; className?: string }) {
  return <Meter value={pct} label={label} tone={tone} size="md" track="overlay" className={cn('h-2', className)} />;
}

// ── Per-core mini bars ────────────────────────────────────────────────────

function CoreGrid({ coreUsage }: { coreUsage: number[] }) {
  if (coreUsage.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 mt-1.5">
      {coreUsage.map((load, i) => (
        <div key={i} className="flex flex-col items-center h-5" style={{ width: 10 }}>
          <Meter
            value={load}
            label={`Core ${i + 1}`}
            tone={load >= 85 ? 'loss' : load >= 60 ? 'warn' : 'chart-1'}
            size="md"
            orientation="vertical"
            track="overlay"
            className="rounded-sm [&>div]:rounded-sm"
          />
        </div>
      ))}
    </div>
  );
}

// ── CPU card ─────────────────────────────────────────────────────────────

const CpuCard = memo(function CpuCard({ cpu, history, view }: { cpu: HardwareData['cpu']; history: HardwareHistory; view: ViewMode }) {
  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Cpu size={12} className="text-th-indigo" />
          <span className="text-xs text-th-hi2 font-medium truncate max-w-[160px]">{cpu.brand}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {cpu.tempCelsius !== null && (
            <span className={cn('text-xs font-mono', tempColor(cpu.tempCelsius))}>{cpu.tempCelsius}°C</span>
          )}
          <span className="text-sm font-semibold text-th-hi tabular-nums">{cpu.usagePercent}%</span>
        </div>
      </div>

      {view === 'sparks' ? (
        <Spark data={history.cpuUsage} tone="chart-1" label="CPU usage history" max={100} />
      ) : (
        <UsageBar pct={cpu.usagePercent} tone="chart-1" label="CPU usage" />
      )}

      <div className="mt-1.5">
        <span className="text-3xs text-th-hi3">
          {cpu.physicalCores}C/{cpu.cores}T · {fmt(cpu.speedGhz)} GHz
        </span>
      </div>

      <CoreGrid coreUsage={cpu.coreUsage} />
    </Card>
  );
});

// ── GPU card ─────────────────────────────────────────────────────────────

const GpuCard = memo(function GpuCard({ gpu, history, view }: { gpu: HardwareData['gpu']; history: HardwareHistory; view: ViewMode }) {
  if (!gpu) {
    return (
      <Card variant="inset" padding="sm">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-th-hi3">No GPU detected</span>
        </div>
      </Card>
    );
  }

  const vramPct = gpu.vramTotalMb > 0 ? Math.round((gpu.vramUsedMb / gpu.vramTotalMb) * 100) : 0;

  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-th-hi2 font-medium truncate max-w-[160px]">{gpu.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {gpu.tempCelsius !== null && (
            <span className={cn('text-xs font-mono', tempColor(gpu.tempCelsius))}>{gpu.tempCelsius}°C</span>
          )}
          <span className="text-sm font-semibold text-th-hi tabular-nums">{gpu.usagePercent}%</span>
        </div>
      </div>

      {view === 'sparks' ? (
        <Spark data={history.gpuUsage} tone="chart-6" label="GPU usage history" max={100} />
      ) : (
        <UsageBar pct={gpu.usagePercent} tone="chart-6" label="GPU usage" />
      )}

      {gpu.vramTotalMb > 0 && (
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-3xs text-th-hi3">
            <span>VRAM</span>
            <span>{fmt(gpu.vramUsedMb / 1024)} / {fmt(gpu.vramTotalMb / 1024)} GB · {vramPct}%</span>
          </div>
          <UsageBar pct={vramPct} tone="chart-6" label="VRAM used" />
        </div>
      )}

      {gpu.clockMhz !== null && (
        <div className="mt-1">
          <span className="text-3xs text-th-hi3">{gpu.clockMhz} MHz</span>
        </div>
      )}
    </Card>
  );
});

// ── RAM card ──────────────────────────────────────────────────────────────

const RamCard = memo(function RamCard({ ram, history, view }: { ram: HardwareData['ram']; history: HardwareHistory; view: ViewMode }) {
  const usedGb = ram.usedMb / 1024;
  const totalGb = ram.totalMb / 1024;

  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-th-hi2 font-medium">RAM</span>
        <div className="flex items-center gap-2">
          <span className="text-3xs text-th-hi3 tabular-nums">{fmt(usedGb)} / {fmt(totalGb, 0)} GB</span>
          <span className="text-sm font-semibold text-th-hi tabular-nums">{ram.usagePercent}%</span>
        </div>
      </div>

      {view === 'sparks' ? (
        <Spark data={history.ramUsage} tone="chart-3" label="RAM usage history" max={100} />
      ) : (
        <UsageBar pct={ram.usagePercent} tone="chart-3" label="RAM usage" />
      )}

      {ram.swapTotalMb > 0 && (
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-3xs text-th-hi3">
            <span>Swap</span>
            <span>{fmt(ram.swapUsedMb / 1024)} / {fmt(ram.swapTotalMb / 1024)} GB</span>
          </div>
          <UsageBar pct={Math.round((ram.swapUsedMb / ram.swapTotalMb) * 100)} tone="accent" label="Swap used" className={METER_NEUTRAL} />
        </div>
      )}
    </Card>
  );
});

// ── Disk card ─────────────────────────────────────────────────────────────

const DiskCard = memo(function DiskCard({ disks, diskUsage, history, view }: {
  disks: HardwareData['disks'];
  diskUsage: HardwareData['diskUsage'];
  history: HardwareHistory;
  view: ViewMode;
}) {
  const d = disks[0] ?? { readMBs: 0, writeMBs: 0 };

  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <HardDrive size={12} className="text-th-chart-7" />
          <span className="text-xs text-th-hi2 font-medium">Disk I/O</span>
        </div>
        <div className="flex gap-3 text-3xs tabular-nums">
          <span className="text-th-emerald">R {fmt(d.readMBs)} MB/s</span>
          <span className="text-th-amber">W {fmt(d.writeMBs)} MB/s</span>
        </div>
      </div>

      {view === 'sparks' && (
        <div className="space-y-1">
          <Spark data={history.diskRead} tone="chart-2" label="Disk read history" />
          <Spark data={history.diskWrite} tone="chart-7" label="Disk write history" />
        </div>
      )}

      {diskUsage.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {diskUsage.map((du) => (
            <div key={du.mount}>
              <div className="flex justify-between text-3xs text-th-hi3 mb-0.5">
                <span className="font-mono">{du.mount}</span>
                <span>{fmt(du.usedGb, 0)} / {fmt(du.totalGb, 0)} GB · {du.usePercent}%</span>
              </div>
              <UsageBar pct={du.usePercent} tone={du.usePercent >= 85 ? 'loss' : 'chart-7'} label={`${du.mount} used`} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
});

// ── Network card ──────────────────────────────────────────────────────────

const NetworkCard = memo(function NetworkCard({ network, history, view }: {
  network: HardwareData['network'];
  history: HardwareHistory;
  view: ViewMode;
}) {
  const totalUp = history.netUp[history.netUp.length - 1] ?? 0;
  const totalDown = history.netDown[history.netDown.length - 1] ?? 0;

  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Wifi size={12} className="text-th-sky" />
          <span className="text-xs text-th-hi2 font-medium">Network</span>
        </div>
        <div className="flex gap-3 text-3xs tabular-nums">
          <span className="text-th-sky">↑ {fmt(totalUp)} Mbps</span>
          <span className="text-th-emerald">↓ {fmt(totalDown)} Mbps</span>
        </div>
      </div>

      {view === 'sparks' && (
        <div className="space-y-1">
          <Spark data={history.netUp} tone="chart-5" label="Upload history" />
          <Spark data={history.netDown} tone="chart-2" label="Download history" />
        </div>
      )}

      {network.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {network.map((n) => (
            <span key={n.iface} className="text-3xs text-th-hi3 font-mono">{n.iface}</span>
          ))}
        </div>
      )}

      {network.length === 0 && (
        <span className="text-3xs text-th-hi3">No active interfaces</span>
      )}
    </Card>
  );
});

// ── Battery row ───────────────────────────────────────────────────────────

const BatteryCard = memo(function BatteryCard({ battery }: { battery: NonNullable<HardwareData['battery']> }) {
  const Icon = battery.charging ? BatteryCharging : Battery;
  const pctTone: MeterTone = battery.percent <= 20 ? 'loss' : battery.percent <= 40 ? 'warn' : 'ok';
  const textColor = battery.percent <= 20 ? 'text-th-loss' : battery.percent <= 40 ? 'text-th-warn' : 'text-th-hi';

  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className={textColor} />
          <span className="text-xs text-th-hi2">Battery</span>
          {battery.charging && <span className="text-3xs text-th-ok">Charging</span>}
        </div>
        <span className={cn('text-sm font-semibold tabular-nums', textColor)}>{battery.percent}%</span>
      </div>
      <UsageBar pct={battery.percent} tone={pctTone} label="Battery charge" />
    </Card>
  );
});

// ── No-battery placeholder ────────────────────────────────────────────────

function NoBatteryCard() {
  return (
    <Card variant="inset" padding="sm">
      <span className="text-xs text-th-hi3">No battery</span>
    </Card>
  );
}

// ── Config panel ──────────────────────────────────────────────────────────

const SECTION_LABELS: Record<HardwareSection, string> = {
  cpu: 'CPU',
  gpu: 'GPU',
  ram: 'RAM',
  disk: 'Disk',
  network: 'Network',
  battery: 'Battery',
};

function ConfigPanel({
  visible,
  setVisible,
}: {
  visible: Record<HardwareSection, boolean>;
  setVisible: (s: HardwareSection, v: boolean) => void;
}) {
  const sections = Object.keys(SECTION_LABELS) as HardwareSection[];
  return (
    <Card variant="inset" padding="sm" className="border-th-line">
      <Label className="block text-3xs mb-2 tracking-wide">Visible sections</Label>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {sections.map((section) => (
          <Checkbox
            key={section}
            size="sm"
            checked={visible[section]}
            onChange={(e) => setVisible(section, e.target.checked)}
            label={SECTION_LABELS[section]}
            className="text-th-hi2"
          />
        ))}
      </div>
    </Card>
  );
}

// ── Top processes panel ───────────────────────────────────────────────────
// Mounted only while open — mounting starts the 5s poll, unmounting stops it,
// so the (Windows-expensive) /processes route is never queried in the background.

const PROC_ROWS = 12;

function ProcessPanel() {
  const { data, isLoading, isError } = useProcesses();
  const procSort = useHardwareUiStore((s) => s.procSort);
  const setProcSort = useHardwareUiStore((s) => s.setProcSort);

  const rows = [...(data?.processes ?? [])]
    .sort((a, b) => (procSort === 'cpu' ? b.cpuPercent - a.cpuPercent : b.memMb - a.memMb))
    .slice(0, PROC_ROWS);

  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <ListTree size={12} className="text-th-teal" />
          <span className="text-xs text-th-hi2 font-medium">Top processes</span>
        </div>
        <Segmented<ProcessSort>
          label="Sort processes by"
          size="xs"
          value={procSort}
          onChange={setProcSort}
          options={[
            { value: 'cpu', label: 'CPU' },
            { value: 'ram', label: 'RAM' },
          ]}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-th-hi3 text-3xs">
          <Spinner size="xs" /> Sampling processes…
        </div>
      ) : isError || !data ? (
        <span className="text-3xs text-th-hi3">Process list unavailable</span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((p) => (
            <div key={p.name} className="flex items-center gap-2 text-3xs leading-relaxed">
              <span className="text-th-hi2 truncate flex-1 min-w-0 font-mono">
                {p.name}{p.count > 1 && <span className="text-th-hi3"> ×{p.count}</span>}
              </span>
              <span className={cn('w-14 text-right tabular-nums shrink-0', procSort === 'cpu' ? 'text-th-hi' : 'text-th-hi3')}>
                {p.cpuPercent.toFixed(1)}%
              </span>
              <span className={cn('w-16 text-right tabular-nums shrink-0', procSort === 'ram' ? 'text-th-hi' : 'text-th-hi3')}>
                {p.memMb >= 1024 ? `${(p.memMb / 1024).toFixed(1)} GB` : `${p.memMb} MB`}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────

/** WidgetShell header actions: sparks/bars view toggle + processes + config + refresh. */
export function HardwareActions() {
  const { view, setView, configOpen, toggleConfig, processesOpen, toggleProcesses } = useHardwareUiStore();
  return (
    <>
      <HeaderAction
        title="Sparkline view"
        active={view === 'sparks'}
        onClick={() => setView('sparks')}
      >
        <Activity size={11} />
      </HeaderAction>
      <HeaderAction
        title="Bar view"
        active={view === 'bars'}
        onClick={() => setView('bars')}
      >
        <BarChart2 size={11} />
      </HeaderAction>
      <HeaderAction title="Top processes" active={processesOpen} onClick={toggleProcesses}>
        <ListTree size={11} />
      </HeaderAction>
      <HeaderAction title="Visible sections" active={configOpen} onClick={toggleConfig}>
        <Settings size={11} />
      </HeaderAction>
      <RefreshAction queryKey={['hardware']} title="Refresh hardware" />
    </>
  );
}

export function HardwareWidget() {
  const { query, history } = useHardware();
  const { visible, setVisible } = useHardwareStore();
  const { view, configOpen, processesOpen } = useHardwareUiStore();

  // Drag-to-scroll (callback ref inside the hook wires up after loading/error resolves)
  const { ref: setScrollEl } = useDragScroll<HTMLDivElement>('y');

  if (query.isLoading) {
    return <SkeletonLines lines={5} className="h-full overflow-hidden" />;
  }

  if (query.isError || !query.data) {
    return <ErrorState message="Failed to load hardware data" queryKey={['hardware']} />;
  }

  const d = query.data;

  return (
    <div ref={setScrollEl} className="p-3 flex flex-col gap-2 h-full overflow-y-auto scrollbar-none">
      {/* Config panel */}
      {configOpen && <ConfigPanel visible={visible} setVisible={setVisible} />}

      {/* Top processes — lazy: polling starts on mount, stops on unmount */}
      {processesOpen && <ProcessPanel />}

      {/* Cards — always rendered when their section is visible */}
      {visible.cpu && <CpuCard cpu={d.cpu} history={history} view={view} />}
      {visible.gpu && <GpuCard gpu={d.gpu} history={history} view={view} />}
      {visible.ram && <RamCard ram={d.ram} history={history} view={view} />}
      {visible.disk && <DiskCard disks={d.disks} diskUsage={d.diskUsage} history={history} view={view} />}
      {visible.network && <NetworkCard network={d.network} history={history} view={view} />}
      {visible.battery && (d.battery ? <BatteryCard battery={d.battery} /> : <NoBatteryCard />)}

      {/* Footer */}
      <div className="flex items-center justify-between px-0.5 shrink-0 mt-auto pt-1">
        <div className="flex items-center gap-1">
          <Thermometer size={10} className="text-th-hi3" />
          <span className="text-3xs text-th-hi3">Uptime {fmtUptime(d.uptime)}</span>
        </div>
        {query.isFetching && <Spinner size="xs" label="Refreshing" className="text-th-hi3" />}
      </div>
    </div>
  );
}
