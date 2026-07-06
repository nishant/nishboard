import { memo, useState } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Activity, BarChart2, Gauge, Loader2, Radio, Settings, Wifi } from 'lucide-react';
import { useNetwork, type NetworkHistory } from './useNetwork';
import { useNetmonStore, type NetmonView } from '../../store/netmonStore';
import { WidgetSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';
import { useDragScroll } from '../../hooks/useDragScroll';
import type { NetworkMonitorData, PingHostStats } from '@dash/shared';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Bars view scales latency against this ceiling (200ms = unusable). */
const LAT_SCALE_MS = 200;
/** Minimum window samples before latency numbers mean anything. */
const MIN_SAMPLES = 3;
/** Window the server aggregates over: 30 samples × 2s tick. */
const WINDOW_LABEL = '60s';

function latClass(ms: number): string {
  if (ms < 30) return 'text-emerald-400';
  if (ms < 80) return 'text-amber-400';
  return 'text-red-400';
}

function latHex(ms: number): string {
  if (ms < 30) return '#34d399';
  if (ms < 80) return '#fbbf24';
  return '#f87171';
}

function fmtMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

// Client-side mirror of the server's host gate (routes/network.ts) so invalid
// input is flagged before it ever hits the API.
const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9.-]{0,251}[a-zA-Z0-9])?$/;

function isValidHost(host: string): boolean {
  return !host.startsWith('-') && HOST_RE.test(host);
}

// ── Presentational helpers — copied locally from HardwareWidget ──────────
// (deliberately NOT extracted/shared in this PR; hardware stays untouched)

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

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-th-elevated/50 rounded-lg p-3">{children}</div>;
}

// ── Latency card (one per host) ───────────────────────────────────────────

const LatencyCard = memo(function LatencyCard({ stats, spark, view }: {
  stats: PingHostStats;
  spark: number[];
  view: NetmonView;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Radio size={12} className="text-sky-400" />
          <span className="text-xs text-th-2 font-medium font-mono truncate max-w-[160px]">{stats.host}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stats.avgMs !== null && (
            <span className="text-[10px] text-th-ghost tabular-nums">avg {fmtMs(stats.avgMs)} ms</span>
          )}
          {stats.latestMs !== null ? (
            <span className={`text-sm font-semibold tabular-nums ${latClass(stats.latestMs)}`}>
              {fmtMs(stats.latestMs)} ms
            </span>
          ) : (
            // Degraded, not error — latest ping lost; the Quality card's loss
            // stat carries the story (e.g. ICMP blocked while traffic flows).
            <span className="text-sm font-semibold text-th-3">—</span>
          )}
        </div>
      </div>

      {stats.samples < MIN_SAMPLES ? (
        <div className="flex items-center gap-2 py-1 text-th-ghost text-[10px]">
          <Loader2 size={11} className="animate-spin" /> Sampling…
        </div>
      ) : view === 'sparks' ? (
        <Spark data={spark} color="#60a5fa" />
      ) : (
        <UsageBar
          pct={((stats.latestMs ?? 0) / LAT_SCALE_MS) * 100}
          color={stats.latestMs !== null ? latHex(stats.latestMs) : '#64748b'}
        />
      )}
    </Card>
  );
});

// ── Quality card (jitter + loss per host) ─────────────────────────────────

const QualityCard = memo(function QualityCard({ hosts }: { hosts: PingHostStats[] }) {
  return (
    <Card>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Gauge size={12} className="text-purple-400" />
        <span className="text-xs text-th-2 font-medium">Quality</span>
      </div>
      <div className="space-y-1.5">
        {hosts.map((h) => (
          <div key={h.host}>
            <div className="flex justify-between text-[10px] text-th-3 mb-0.5">
              <span className="font-mono">{h.host}</span>
              <span className="tabular-nums">
                jitter {h.jitterMs !== null ? `${h.jitterMs.toFixed(1)} ms` : '—'} · loss {h.lossPct.toFixed(0)}%
              </span>
            </div>
            <UsageBar pct={h.lossPct} color={h.lossPct >= 5 ? '#f87171' : '#34d399'} />
          </div>
        ))}
      </div>
    </Card>
  );
});

// ── Throughput card ───────────────────────────────────────────────────────

const ThroughputCard = memo(function ThroughputCard({ totals, ifaces, history, view }: {
  totals: NetworkMonitorData['totals'];
  ifaces: NetworkMonitorData['ifaces'];
  history: NetworkHistory;
  view: NetmonView;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Wifi size={12} className="text-sky-400" />
          <span className="text-xs text-th-2 font-medium">Throughput</span>
        </div>
        <div className="flex gap-3 text-[10px] tabular-nums">
          <span className="text-sky-400">↑ {totals.upMbps.toFixed(1)} Mbps</span>
          <span className="text-emerald-400">↓ {totals.downMbps.toFixed(1)} Mbps</span>
        </div>
      </div>

      {view === 'sparks' && (
        <div className="space-y-1">
          <Spark data={history.netUp} color="#38bdf8" />
          <Spark data={history.netDown} color="#34d399" />
        </div>
      )}

      {ifaces.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {ifaces.map((n) => (
            <span key={n.iface} className="text-[10px] text-th-3 font-mono">{n.iface}</span>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-th-ghost">No active interfaces</span>
      )}
    </Card>
  );
});

// ── Config panel ──────────────────────────────────────────────────────────

function ConfigPanel() {
  const hosts = useNetmonStore((s) => s.hosts);
  const setHosts = useNetmonStore((s) => s.setHosts);
  const [drafts, setDrafts] = useState<[string, string]>([hosts[0] ?? '', hosts[1] ?? '']);

  const valid = drafts.every(isValidHost);
  const dirty = drafts[0] !== (hosts[0] ?? '') || drafts[1] !== (hosts[1] ?? '');

  return (
    <div className="bg-th-elevated rounded-lg p-3 border border-th-line">
      <p className="text-[10px] text-th-3 mb-2 uppercase tracking-wide">Ping targets</p>
      <div className="flex flex-col gap-2">
        {([0, 1] as const).map((i) => (
          <input
            key={i}
            value={drafts[i]}
            onChange={(e) => {
              const next: [string, string] = [...drafts];
              next[i] = e.target.value.trim();
              setDrafts(next);
            }}
            placeholder={i === 0 ? '1.1.1.1' : '8.8.8.8'}
            spellCheck={false}
            className={`bg-th-elevated rounded px-2 py-1 text-xs font-mono text-th-hi border outline-none transition-colors placeholder:text-th-ghost ${
              isValidHost(drafts[i]) ? 'border-th-line focus:border-th-3' : 'border-red-400/60'
            }`}
          />
        ))}
        <button
          onClick={() => setHosts([drafts[0], drafts[1]])}
          disabled={!valid || !dirty}
          className="self-end px-2.5 py-1 rounded text-[10px] uppercase tracking-wide bg-th-overlay text-th-hi disabled:opacity-40 disabled:cursor-default hover:enabled:bg-th-elevated transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────

/** WidgetShell header actions: sparks/bars view toggle + config + refresh. */
export function NetworkMonitorActions() {
  const { view, setView, configOpen, toggleConfig } = useNetmonStore();
  return (
    <>
      <HeaderAction title="Sparkline view" active={view === 'sparks'} onClick={() => setView('sparks')}>
        <Activity size={11} />
      </HeaderAction>
      <HeaderAction title="Bar view" active={view === 'bars'} onClick={() => setView('bars')}>
        <BarChart2 size={11} />
      </HeaderAction>
      <HeaderAction title="Ping targets" active={configOpen} onClick={toggleConfig}>
        <Settings size={11} />
      </HeaderAction>
      <RefreshAction queryKey={['network']} title="Refresh network" />
    </>
  );
}

export function NetworkMonitorWidget() {
  const { query, history } = useNetwork();
  const { view, configOpen } = useNetmonStore();

  const { ref: setScrollEl } = useDragScroll<HTMLDivElement>('y');

  if (query.isLoading) {
    return <WidgetSkeleton lines={4} />;
  }

  // Only a dead API is an error. All-pings-lost with live throughput (ICMP
  // blocked) renders normally — em-dash latencies + a red loss bar tell that
  // story per host instead of a widget-level error state.
  if (query.isError || !query.data) {
    return <ErrorState message="Failed to load network data" queryKey={['network']} />;
  }

  const d = query.data;

  return (
    <div ref={setScrollEl} className="p-3 flex flex-col gap-2 h-full overflow-y-auto scrollbar-none">
      {configOpen && <ConfigPanel />}

      {d.hosts.map((h) => (
        <LatencyCard key={h.host} stats={h} spark={history.latency[h.host] ?? []} view={view} />
      ))}

      <QualityCard hosts={d.hosts} />

      <ThroughputCard totals={d.totals} ifaces={d.ifaces} history={history} view={view} />

      {/* Footer */}
      <div className="flex items-center justify-between px-0.5 shrink-0 mt-auto pt-1">
        <span className="text-[10px] text-th-ghost">Ping every 2s · last {WINDOW_LABEL}</span>
        {query.isFetching && <Loader2 size={10} className="text-th-ghost animate-spin" />}
      </div>
    </div>
  );
}
