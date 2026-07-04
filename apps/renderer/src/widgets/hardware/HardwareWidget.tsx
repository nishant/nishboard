import { memo } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Cpu, Thermometer, HardDrive, Wifi, Battery, BatteryCharging, BarChart2, Activity, Settings, Loader2 } from 'lucide-react';
import { useHardware, type HardwareHistory } from './useHardware';
import { useHardwareStore, type HardwareSection } from '../../store/hardwareStore';
import { useHardwareUiStore } from '../../store/hardwareUiStore';
import type { HardwareViewMode } from '../../store/hardwareUiStore';
import { WidgetSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';
import { useDragScroll } from '../../hooks/useDragScroll';
import { fmtUptime } from '../../lib/time';
import type { HardwareData } from '@dash/shared';

// ── Helpers ──────────────────────────────────────────────────────────────

function fmt(n: number, dec = 1): string {
  return n.toFixed(dec);
}

function tempColor(c: number | null): string {
  if (c === null) return 'text-th-3';
  if (c >= 85) return 'text-red-400';
  if (c >= 70) return 'text-amber-400';
  return 'text-emerald-400';
}

type ViewMode = HardwareViewMode;

// ── Sparkline ────────────────────────────────────────────────────────────

function Spark({ data, color }: { data: number[]; color: string }) {
  const points = data.map((v) => ({ v }));
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={color}
          fillOpacity={0.15}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Usage bar ────────────────────────────────────────────────────────────

function UsageBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full h-2 rounded-full bg-th-elevated overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Per-core mini bars ────────────────────────────────────────────────────

function CoreGrid({ coreUsage }: { coreUsage: number[] }) {
  if (coreUsage.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-0.5 mt-1.5">
      {coreUsage.map((load, i) => (
        <div key={i} className="flex flex-col items-center" style={{ width: 10 }}>
          <div className="w-2.5 bg-th-elevated rounded-sm overflow-hidden" style={{ height: 20 }}>
            <div
              className="w-full rounded-sm"
              style={{
                height: `${load}%`,
                backgroundColor: load >= 85 ? '#f87171' : load >= 60 ? '#fbbf24' : '#60a5fa',
                transition: 'height 0.3s',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-th-elevated/50 rounded-lg p-3">{children}</div>;
}

// ── CPU card ─────────────────────────────────────────────────────────────

const CpuCard = memo(function CpuCard({ cpu, history, view }: { cpu: HardwareData['cpu']; history: HardwareHistory; view: ViewMode }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Cpu size={12} className="text-blue-400" />
          <span className="text-xs text-th-2 font-medium truncate max-w-[160px]">{cpu.brand}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {cpu.tempCelsius !== null && (
            <span className={`text-xs font-mono ${tempColor(cpu.tempCelsius)}`}>{cpu.tempCelsius}°C</span>
          )}
          <span className="text-sm font-semibold text-th-hi tabular-nums">{cpu.usagePercent}%</span>
        </div>
      </div>

      {view === 'sparks' ? (
        <Spark data={history.cpuUsage} color="#60a5fa" />
      ) : (
        <UsageBar pct={cpu.usagePercent} color="#60a5fa" />
      )}

      <div className="mt-1.5">
        <span className="text-[10px] text-th-3">
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
      <Card>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-th-3">No GPU detected</span>
        </div>
      </Card>
    );
  }

  const vramPct = gpu.vramTotalMb > 0 ? Math.round((gpu.vramUsedMb / gpu.vramTotalMb) * 100) : 0;

  return (
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-th-2 font-medium truncate max-w-[160px]">{gpu.name}</span>
        <div className="flex items-center gap-2 shrink-0">
          {gpu.tempCelsius !== null && (
            <span className={`text-xs font-mono ${tempColor(gpu.tempCelsius)}`}>{gpu.tempCelsius}°C</span>
          )}
          <span className="text-sm font-semibold text-th-hi tabular-nums">{gpu.usagePercent}%</span>
        </div>
      </div>

      {view === 'sparks' ? (
        <Spark data={history.gpuUsage} color="#c084fc" />
      ) : (
        <UsageBar pct={gpu.usagePercent} color="#c084fc" />
      )}

      {gpu.vramTotalMb > 0 && (
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-[10px] text-th-3">
            <span>VRAM</span>
            <span>{fmt(gpu.vramUsedMb / 1024)} / {fmt(gpu.vramTotalMb / 1024)} GB · {vramPct}%</span>
          </div>
          <UsageBar pct={vramPct} color="#a855f7" />
        </div>
      )}

      {gpu.clockMhz !== null && (
        <div className="mt-1">
          <span className="text-[10px] text-th-3">{gpu.clockMhz} MHz</span>
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
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-th-2 font-medium">RAM</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-th-3 tabular-nums">{fmt(usedGb)} / {fmt(totalGb, 0)} GB</span>
          <span className="text-sm font-semibold text-th-hi tabular-nums">{ram.usagePercent}%</span>
        </div>
      </div>

      {view === 'sparks' ? (
        <Spark data={history.ramUsage} color="#fbbf24" />
      ) : (
        <UsageBar pct={ram.usagePercent} color="#fbbf24" />
      )}

      {ram.swapTotalMb > 0 && (
        <div className="mt-2 space-y-1">
          <div className="flex justify-between text-[10px] text-th-3">
            <span>Swap</span>
            <span>{fmt(ram.swapUsedMb / 1024)} / {fmt(ram.swapTotalMb / 1024)} GB</span>
          </div>
          <UsageBar pct={Math.round((ram.swapUsedMb / ram.swapTotalMb) * 100)} color="#f59e0b" />
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
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <HardDrive size={12} className="text-orange-400" />
          <span className="text-xs text-th-2 font-medium">Disk I/O</span>
        </div>
        <div className="flex gap-3 text-[10px] tabular-nums">
          <span className="text-emerald-400">R {fmt(d.readMBs)} MB/s</span>
          <span className="text-orange-400">W {fmt(d.writeMBs)} MB/s</span>
        </div>
      </div>

      {view === 'sparks' && (
        <div className="space-y-1">
          <Spark data={history.diskRead} color="#34d399" />
          <Spark data={history.diskWrite} color="#fb923c" />
        </div>
      )}

      {diskUsage.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {diskUsage.map((du) => (
            <div key={du.mount}>
              <div className="flex justify-between text-[10px] text-th-3 mb-0.5">
                <span className="font-mono">{du.mount}</span>
                <span>{fmt(du.usedGb, 0)} / {fmt(du.totalGb, 0)} GB · {du.usePercent}%</span>
              </div>
              <UsageBar pct={du.usePercent} color={du.usePercent >= 85 ? '#f87171' : '#fb923c'} />
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
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Wifi size={12} className="text-sky-400" />
          <span className="text-xs text-th-2 font-medium">Network</span>
        </div>
        <div className="flex gap-3 text-[10px] tabular-nums">
          <span className="text-sky-400">↑ {fmt(totalUp)} Mbps</span>
          <span className="text-emerald-400">↓ {fmt(totalDown)} Mbps</span>
        </div>
      </div>

      {view === 'sparks' && (
        <div className="space-y-1">
          <Spark data={history.netUp} color="#38bdf8" />
          <Spark data={history.netDown} color="#34d399" />
        </div>
      )}

      {network.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {network.map((n) => (
            <span key={n.iface} className="text-[10px] text-th-3 font-mono">{n.iface}</span>
          ))}
        </div>
      )}

      {network.length === 0 && (
        <span className="text-[10px] text-th-ghost">No active interfaces</span>
      )}
    </Card>
  );
});

// ── Battery row ───────────────────────────────────────────────────────────

const BatteryCard = memo(function BatteryCard({ battery }: { battery: NonNullable<HardwareData['battery']> }) {
  const Icon = battery.charging ? BatteryCharging : Battery;
  const pctColor = battery.percent <= 20 ? '#f87171' : battery.percent <= 40 ? '#fbbf24' : '#34d399';
  const textColor = battery.percent <= 20 ? 'text-red-400' : battery.percent <= 40 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className={textColor} />
          <span className="text-xs text-th-2">Battery</span>
          {battery.charging && <span className="text-[10px] text-emerald-400">Charging</span>}
        </div>
        <span className={`text-sm font-semibold tabular-nums ${textColor}`}>{battery.percent}%</span>
      </div>
      <UsageBar pct={battery.percent} color={pctColor} />
    </Card>
  );
});

// ── No-battery placeholder ────────────────────────────────────────────────

function NoBatteryCard() {
  return (
    <Card>
      <span className="text-xs text-th-3">No battery</span>
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
    <div className="bg-th-elevated rounded-lg p-3 border border-th-line">
      <p className="text-[10px] text-th-3 mb-2 uppercase tracking-wide">Visible sections</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {sections.map((section) => (
          <label key={section} className="flex items-center gap-2 cursor-pointer group">
            {/* Real checkbox (visually hidden) so the toggle is keyboard-focusable
                and screen-reader announceable; the styled div is just its face. */}
            <input
              type="checkbox"
              checked={visible[section]}
              onChange={(e) => setVisible(section, e.target.checked)}
              className="sr-only peer"
            />
            <div
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-th-accent ${
                visible[section]
                  ? 'bg-th-hi border-th-hi'
                  : 'bg-transparent border-th-ghost group-hover:border-th-3'
              }`}
            >
              {visible[section] && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4l2.5 2.5L9 1" stroke="rgb(var(--t-bg))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span className="text-xs text-th-2 select-none">
              {SECTION_LABELS[section]}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────

/** WidgetShell header actions: sparks/bars view toggle + section config + refresh. */
export function HardwareActions() {
  const { view, setView, configOpen, toggleConfig } = useHardwareUiStore();
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
  const { view, configOpen } = useHardwareUiStore();

  // Drag-to-scroll (callback ref inside the hook wires up after loading/error resolves)
  const { ref: setScrollEl } = useDragScroll<HTMLDivElement>('y');

  if (query.isLoading) {
    return <WidgetSkeleton lines={5} />;
  }

  if (query.isError || !query.data) {
    return <ErrorState message="Failed to load hardware data" queryKey={['hardware']} />;
  }

  const d = query.data;

  return (
    <div ref={setScrollEl} className="p-3 flex flex-col gap-2 h-full overflow-y-auto scrollbar-none">
      {/* Config panel */}
      {configOpen && <ConfigPanel visible={visible} setVisible={setVisible} />}

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
          <Thermometer size={10} className="text-th-ghost" />
          <span className="text-[10px] text-th-ghost">Uptime {fmtUptime(d.uptime)}</span>
        </div>
        {query.isFetching && <Loader2 size={10} className="text-th-ghost animate-spin" />}
      </div>
    </div>
  );
}
