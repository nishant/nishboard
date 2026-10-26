import { useEffect, useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useCountdownStore } from '../../store/countdownStore';
import { useAppSettingsStore } from '../../store/settingsStore';
import { fireAlert } from '../../lib/alerts';
import { fmtRemaining, hourFormat } from '../../lib/time';
import { Card, EmptyState, IconButton, cn } from '@nish/ui';
import { Input } from '../../components/nishGaps';

function fmtDate(at: number, clock24h: boolean): string {
  return new Date(at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...hourFormat(clock24h),
  });
}

export function CountdownWidget() {
  const { events, addEvent, removeEvent } = useCountdownStore();
  const clock24h = useAppSettingsStore((s) => s.clock24h);
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
    // Reject past datetimes — they'd render "now" and fire an alert on the next tick.
    if (Number.isNaN(at) || at <= Date.now()) return;
    addEvent(label.trim(), at);
    setLabel('');
    setWhen('');
  }

  return (
    <div className="h-full flex flex-col p-2 gap-2">
      <div className="flex items-center gap-1 shrink-0">
        <Input
          size="xs"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Event"
          aria-label="Event name"
          className="flex-1"
        />
        <Input
          size="xs"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          aria-label="Event date and time"
          className="w-auto text-3xs tabular-nums"
        />
        <IconButton label="Add event" size="sm" variant="subtle" onClick={submit} disabled={!when}>
          <Plus size={14} />
        </IconButton>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
        {events.length === 0 ? (
          <EmptyState compact title="No events" />
        ) : (
          events.map((e) => {
            const remaining = e.at - now;
            const passed = remaining <= 0;
            return (
              <Card key={e.id} variant="inset" padding="none" className="group flex items-center gap-2 px-2 py-1.5">
                <div className="flex flex-col flex-1 min-w-0">
                  <span className={cn('text-xs truncate', passed ? 'text-th-hi3' : 'text-th-hi')}>{e.label || 'Event'}</span>
                  <span className="text-th-hi3 text-3xs truncate">{fmtDate(e.at, clock24h)}</span>
                </div>
                <span className={cn('text-sm tabular-nums shrink-0', passed ? 'text-th-warn' : 'text-th-hi')}>
                  {passed ? 'now' : fmtRemaining(remaining)}
                </span>
                <IconButton
                  label="Delete"
                  size="xs"
                  tone="danger"
                  onClick={() => removeEvent(e.id)}
                  className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                >
                  <X size={13} />
                </IconButton>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
