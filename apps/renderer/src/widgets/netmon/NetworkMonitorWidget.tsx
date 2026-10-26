import { memo, useState } from 'react';
import { Activity, BarChart2, Gauge, Radio, Settings, Wifi } from 'lucide-react';
import { useNetwork, type NetworkHistory } from './useNetwork';
import { useNetmonStore, type NetmonView } from '../../store/netmonStore';
import { ErrorState } from '../../components/ErrorState';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';
import { useDragScroll } from '../../hooks/useDragScroll';
import type { NetworkMonitorData, PingHostStats } from '@dash/shared';
import { Button, Card, Meter, SkeletonLines, Sparkline, Spinner, cn, type MeterTone, type SparklineTone } from '@nish/ui';
import { Input } from '../../components/nishGaps';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Bars view scales latency against this ceiling (200ms = unusable). */
const LAT_SCALE_MS = 200;
/** Minimum window samples before latency numbers mean anything. */
const MIN_SAMPLES = 3;
/** Window the server aggregates over: 30 samples × 2s tick. */
const WINDOW_LABEL = '60s';

function latClass(ms: number): string {
  if (ms < 30) return 'text-th-ok';
  if (ms < 80) return 'text-th-warn';
  return 'text-th-loss';
}

function latTone(ms: number): MeterTone {
  if (ms < 30) return 'chart-1';
  if (ms < 80) return 'warn';
  return 'loss';
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

// ── Presentational helpers (same recipes as HardwareWidget, on @nish/ui) ──

function Spark({ data, tone, label }: { data: number[]; tone: SparklineTone; label: string }) {
  return <Sparkline values={data} label={label} tone={tone} height={32} min={0} fill className="w-full" />;
}

function UsageBar({ pct, tone, label, className }: { pct: number; tone: MeterTone; label: string; className?: string }) {
  return <Meter value={pct} label={label} tone={tone} size="md" track="overlay" className={cn('h-2', className)} />;
}

// ── Latency card (one per host) ───────────────────────────────────────────

const LatencyCard = memo(function LatencyCard({ stats, spark, view }: {
  stats: PingHostStats;
  spark: number[];
  view: NetmonView;
}) {
  return (
    <Card variant="inset" padding="sm">
      {/* @container: in a narrow tile the avg drops out before the host truncates. */}
      <div className="@container flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Radio size={12} className="text-th-sky shrink-0" />
          <span className="text-xs text-th-hi2 font-medium font-mono truncate max-w-[160px]" title={stats.host}>{stats.host}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {stats.avgMs !== null && (
            <span className="text-[10px] text-th-hi3 tabular-nums @max-[11rem]:hidden">avg {fmtMs(stats.avgMs)} ms</span>
          )}
          {stats.latestMs !== null ? (
            <span className={cn('text-sm font-semibold tabular-nums', latClass(stats.latestMs))}>
              {fmtMs(stats.latestMs)} ms
            </span>
          ) : (
            // Degraded, not error — latest ping lost; the Quality card's loss
            // stat carries the story (e.g. ICMP blocked while traffic flows).
            <span className="text-sm font-semibold text-th-hi3">—</span>
          )}
        </div>
      </div>

      {stats.samples < MIN_SAMPLES ? (
        <div className="flex items-center gap-2 py-1 text-th-hi3 text-[10px]">
          <Spinner size="xs" /> Sampling…
        </div>
      ) : view === 'sparks' ? (
        <Spark data={spark} tone="chart-1" label={`${stats.host} latency history`} />
      ) : (
        <UsageBar
          pct={((stats.latestMs ?? 0) / LAT_SCALE_MS) * 100}
          tone={stats.latestMs !== null ? latTone(stats.latestMs) : 'chart-1'}
          label={`${stats.host} latency`}
        />
      )}
    </Card>
  );
});

// ── Quality card (jitter + loss per host) ─────────────────────────────────

const QualityCard = memo(function QualityCard({ hosts }: { hosts: PingHostStats[] }) {
  return (
    <Card variant="inset" padding="sm">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Gauge size={12} className="text-th-violet" />
        <span className="text-xs text-th-hi2 font-medium">Quality</span>
      </div>
      <div className="space-y-1.5">
        {hosts.map((h) => (
          <div key={h.host}>
            <div className="flex justify-between text-[10px] text-th-hi3 mb-0.5">
              <span className="font-mono">{h.host}</span>
              <span className="tabular-nums">
                jitter {h.jitterMs !== null ? `${h.jitterMs.toFixed(1)} ms` : '—'} · loss {h.lossPct.toFixed(0)}%
              </span>
            </div>
            <UsageBar pct={h.lossPct} tone={h.lossPct >= 5 ? 'loss' : 'chart-1'} label={`${h.host} packet loss`} />
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
    <Card variant="inset" padding="sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Wifi size={12} className="text-th-sky" />
          <span className="text-xs text-th-hi2 font-medium">Throughput</span>
        </div>
        <div className="flex gap-3 text-[10px] tabular-nums">
          <span className="text-th-sky">↑ {totals.upMbps.toFixed(1)} Mbps</span>
          <span className="text-th-emerald">↓ {totals.downMbps.toFixed(1)} Mbps</span>
        </div>
      </div>

      {view === 'sparks' && (
        <div className="space-y-1">
          <Spark data={history.netUp} tone="chart-5" label="Upload history" />
          <Spark data={history.netDown} tone="chart-2" label="Download history" />
        </div>
      )}

      {ifaces.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {ifaces.map((n) => (
            <span key={n.iface} className="text-[10px] text-th-hi3 font-mono">{n.iface}</span>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-th-hi3">No active interfaces</span>
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
    <Card variant="inset" padding="sm" className="border-th-line">
      <p className="text-[10px] text-th-hi3 mb-2 uppercase tracking-wide">Ping targets</p>
      <div className="flex flex-col gap-2">
        {([0, 1] as const).map((i) => (
          <Input
            key={i}
            size="xs"
            aria-label={`Ping target ${i + 1}`}
            invalid={!isValidHost(drafts[i])}
            value={drafts[i]}
            onChange={(e) => {
              const next: [string, string] = [...drafts];
              next[i] = e.target.value.trim();
              setDrafts(next);
            }}
            placeholder={i === 0 ? '1.1.1.1' : '8.8.8.8'}
            spellCheck={false}
            className="font-mono bg-th-surface"
          />
        ))}
        <Button
          size="xs"
          variant="primary"
          onClick={() => setHosts([drafts[0], drafts[1]])}
          disabled={!valid || !dirty}
          className="self-end"
        >
          Apply
        </Button>
      </div>
    </Card>
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
    return <SkeletonLines lines={4} className="h-full overflow-hidden" />;
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
        <span className="text-[10px] text-th-hi3">Ping every 2s · last {WINDOW_LABEL}</span>
        {query.isFetching && <Spinner size="xs" label="Refreshing" className="text-th-hi3" />}
      </div>
    </div>
  );
}
