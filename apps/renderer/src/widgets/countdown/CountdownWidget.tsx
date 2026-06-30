import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useCountdownStore } from '../../store/countdownStore';
import { fireAlert } from '../../lib/alerts';
import { cn } from '../../lib/utils';

function fmtRemaining(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtDate(at: number): string {
  return new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function CountdownWidget() {
  const { events, addEvent, removeEvent } = useCountdownStore();
  const [label, setLabel] = useState('');
  const [when, setWhen] = useState('');
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const st = useCountdownStore.getState();
      const now = Date.now();
      st.events.forEach((e) => {
        if (!e.notified && now >= e.at) {
          st.markNotified(e.id);
          fireAlert('Countdown', e.label || 'Event reached');
        }
      });
      setNow(now);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();

  function submit() {
    if (!when) return;
    const at = new Date(when).getTime();
    if (Number.isNaN(at)) return;
    addEvent(label.trim(), at);
    setLabel('');
    setWhen('');
  }

  return (
    <div className="h-full flex flex-col p-2 gap-2">
      <div className="flex items-center gap-1 shrink-0">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Event"
          className="flex-1 min-w-0 bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[11px] placeholder:text-th-ghost focus:outline-none focus:border-th-3"
        />
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[10px] tabular-nums focus:outline-none focus:border-th-3"
        />
        <button
          onClick={submit}
          disabled={!when}
          className="shrink-0 p-1.5 rounded-lg bg-th-overlay hover:bg-th-overlay/70 text-th-hi disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Add event"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
        {events.length === 0 ? (
          <div className="h-full flex items-center justify-center text-th-ghost text-xs">No events</div>
        ) : (
          events.map((e) => {
            const remaining = e.at - now;
            const passed = remaining <= 0;
            return (
              <div key={e.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-th-elevated/40">
                <div className="flex flex-col flex-1 min-w-0">
                  <span className={cn('text-xs truncate', passed ? 'text-th-ghost' : 'text-th-hi')}>{e.label || 'Event'}</span>
                  <span className="text-th-ghost text-[10px] truncate">{fmtDate(e.at)}</span>
                </div>
                <span className={cn('text-sm tabular-nums shrink-0', passed ? 'text-amber-500/70' : 'text-th-accent')}>
                  {passed ? 'now' : fmtRemaining(remaining)}
                </span>
                <button
                  onClick={() => removeEvent(e.id)}
                  className="shrink-0 p-1 rounded text-th-ghost hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                  title="Delete"
                >
                  <X size={13} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
