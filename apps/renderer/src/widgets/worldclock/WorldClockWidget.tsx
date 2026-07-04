import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useWorldClockStore } from '../../store/worldClockStore';
import { useAppSettingsStore } from '../../store/settingsStore';
import { cn } from '../../lib/utils';
import { hourFormat } from '../../lib/time';
import { EmptyState } from '../../components/EmptyState';

const COMMON_ZONES: { tz: string; label: string }[] = [
  { tz: 'Pacific/Honolulu', label: 'Honolulu' },
  { tz: 'America/Los_Angeles', label: 'Los Angeles' },
  { tz: 'America/Denver', label: 'Denver' },
  { tz: 'America/Chicago', label: 'Chicago' },
  { tz: 'America/New_York', label: 'New York' },
  { tz: 'America/Sao_Paulo', label: 'São Paulo' },
  { tz: 'Europe/London', label: 'London' },
  { tz: 'Europe/Paris', label: 'Paris' },
  { tz: 'Europe/Berlin', label: 'Berlin' },
  { tz: 'Europe/Moscow', label: 'Moscow' },
  { tz: 'Asia/Dubai', label: 'Dubai' },
  { tz: 'Asia/Kolkata', label: 'Mumbai' },
  { tz: 'Asia/Singapore', label: 'Singapore' },
  { tz: 'Asia/Shanghai', label: 'Shanghai' },
  { tz: 'Asia/Tokyo', label: 'Tokyo' },
  { tz: 'Australia/Sydney', label: 'Sydney' },
  { tz: 'Pacific/Auckland', label: 'Auckland' },
  { tz: 'UTC', label: 'UTC' },
];

function useTick(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function zoneLabel(tz: string): string {
  const common = COMMON_ZONES.find((z) => z.tz === tz);
  if (common) return common.label;
  return tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
}

function timeParts(tz: string, now: Date): { h: number; m: number; s: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  let h = get('hour');
  if (h === 24) h = 0; // some engines emit '24' for midnight
  return { h, m: get('minute'), s: get('second') };
}

function digitalTime(tz: string, now: Date, clock24h: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', ...hourFormat(clock24h),
  }).format(now);
}

function dayLabel(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
}

function AnalogClock({ tz, now, size = 56 }: { tz: string; now: Date; size?: number }) {
  const { h, m, s } = timeParts(tz, now);
  const c = size / 2;
  const hand = (angle: number, len: number, w: number, color: string, key: string) => {
    const rad = (angle - 90) * (Math.PI / 180);
    return (
      <line key={key} x1={c} y1={c} x2={c + len * Math.cos(rad)} y2={c + len * Math.sin(rad)}
        stroke={color} strokeWidth={w} strokeLinecap="round" />
    );
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={c} cy={c} r={c - 1} fill="rgb(var(--t-elevated))" stroke="rgb(var(--t-line))" strokeWidth="1.5" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 - 90) * (Math.PI / 180);
        return <circle key={i} cx={c + (c - 4) * Math.cos(a)} cy={c + (c - 4) * Math.sin(a)} r={i % 3 === 0 ? 1.3 : 0.7} fill="rgb(var(--t-ghost))" />;
      })}
      {hand((h % 12) * 30 + m * 0.5, c * 0.5, 2, 'rgb(var(--t-hi))', 'h')}
      {hand(m * 6 + s * 0.1, c * 0.72, 1.5, 'rgb(var(--t-2))', 'm')}
      {hand(s * 6, c * 0.8, 0.8, 'rgb(var(--t-accent))', 's')}
      <circle cx={c} cy={c} r={1.6} fill="rgb(var(--t-accent))" />
    </svg>
  );
}

// Ticking leaf: the 1s re-render is confined to the clock list — the toolbar
// (and anything else the widget grows) doesn't re-render every second.
function ClockList({
  zones, view, removeZone,
}: {
  zones: string[];
  view: 'digital' | 'analog';
  removeZone: (tz: string) => void;
}) {
  useTick(1000);
  const clock24h = useAppSettingsStore((s) => s.clock24h);
  const now = new Date();

  if (zones.length === 0) {
    return <EmptyState message="No clocks — add one" />;
  }

  if (view === 'digital') {
    return (
      <div className="flex flex-col gap-1">
        {zones.map((tz) => (
          <div key={tz} className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-th-elevated/50">
            <div className="flex flex-col min-w-0">
              <span className="text-th-hi text-sm tabular-nums leading-tight">{digitalTime(tz, now, clock24h)}</span>
              <span className="text-th-ghost text-[10px] truncate">{zoneLabel(tz)} · {dayLabel(tz, now)}</span>
            </div>
            <button
              onClick={() => removeZone(tz)}
              className="ml-auto shrink-0 p-0.5 rounded text-th-ghost hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
              title="Remove"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 justify-items-center p-1">
      {zones.map((tz) => (
        <div key={tz} className="group relative flex flex-col items-center gap-0.5 w-full">
          <AnalogClock tz={tz} now={now} />
          <span className="text-th-ghost text-[10px] truncate max-w-full">{zoneLabel(tz)}</span>
          <button
            onClick={() => removeZone(tz)}
            className="absolute top-0 right-0 p-0.5 rounded text-th-ghost hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
            title="Remove"
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function WorldClockWidget() {
  const { zones, view, addZone, removeZone, setView } = useWorldClockStore();
  const available = COMMON_ZONES.filter((z) => !zones.includes(z.tz));

  return (
    <div className="h-full flex flex-col p-2 gap-2">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex rounded-lg bg-th-elevated p-0.5">
          {(['digital', 'analog'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] capitalize transition-colors',
                view === v ? 'bg-th-overlay text-th-hi' : 'text-th-ghost hover:text-th-2',
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <select
          value=""
          onChange={(e) => { if (e.target.value) addZone(e.target.value); }}
          className="ml-auto bg-th-elevated border border-th-line rounded-lg px-2 py-1 text-[10px] text-th-2 focus:outline-none focus:border-th-3"
          title="Add timezone"
        >
          <option value="">+ Add</option>
          {available.map((z) => <option key={z.tz} value={z.tz}>{z.label}</option>)}
        </select>
      </div>

      {/* Clocks */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ClockList zones={zones} view={view} removeZone={removeZone} />
      </div>
    </div>
  );
}
