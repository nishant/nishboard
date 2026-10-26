import { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, X, Plus, Bell } from 'lucide-react';
import { useTimersStore } from '../../store/timersStore';
import { useAppSettingsStore } from '../../store/settingsStore';
import { fireAlert } from '../../lib/alerts';
import { fmtDuration, relTimeUntil, hourFormat } from '../../lib/time';
import { Card, EmptyState, IconButton, TabPanel, Tabs, cn } from '@nish/ui';
import { Input } from '../../components/nishGaps';

type Tab = 'timer' | 'alarm';

const TABS: { value: Tab; label: string }[] = [
  { value: 'timer', label: 'Timer' },
  { value: 'alarm', label: 'Alarm' },
];

function fmtAlarm(at: number, clock24h: boolean): string {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...hourFormat(clock24h) });
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}

function timeToTimestamp(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= Date.now()) {
    // Next occurrence by wall clock — setDate (not +24h in ms) so the alarm
    // stays at the entered local time across a DST transition.
    d.setDate(d.getDate() + 1);
  }
  return d.getTime();
}

export function TimerWidget() {
  const [tab, setTab] = useState<Tab>('timer');
  const clock24h = useAppSettingsStore((s) => s.clock24h);
  const { timers, alarms, addTimer, startTimer, pauseTimer, resetTimer, removeTimer,
    addAlarm, removeAlarm } = useTimersStore();

  // Add-form state
  const [tLabel, setTLabel] = useState('');
  const [tMin, setTMin] = useState('5');
  const [tSec, setTSec] = useState('0');
  const [aLabel, setALabel] = useState('');
  const [aTime, setATime] = useState('');

  // Single interval: fire alerts (side effects out of render) + force display refresh.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const st = useTimersStore.getState();
      const now = Date.now();
      st.timers.forEach((t) => {
        if (t.running && t.endsAt != null && now >= t.endsAt) {
          st.finishTimer(t.id);
          fireAlert('Timer done', t.label || 'Your timer finished');
        }
      });
      st.alarms.forEach((a) => {
        if (!a.done && now >= a.at) {
          st.markAlarmDone(a.id);
          fireAlert('Alarm', a.label || 'Alarm');
        }
      });
      setNow(now);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();

  function submitTimer() {
    const ms = (Number(tMin || 0) * 60 + Number(tSec || 0)) * 1000;
    if (ms <= 0) return;
    addTimer(tLabel.trim(), ms);
    setTLabel('');
  }
  function submitAlarm() {
    const at = timeToTimestamp(aTime);
    if (at == null) return;
    addAlarm(aLabel.trim(), at);
    setALabel('');
    setATime('');
  }

  return (
    <div className="h-full flex flex-col p-2 gap-2">
      <Tabs
        label="Timer or alarm"
        variant="pill"
        size="sm"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        items={TABS}
        className="shrink-0 self-start"
      >
        <TabPanel value="timer" className="flex-1 min-h-0 flex flex-col gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <Input size="xs" value={tLabel} onChange={(e) => setTLabel(e.target.value)} placeholder="Label"
              aria-label="Timer label" className="flex-1" />
            <Input size="xs" type="number" min={0} value={tMin} onChange={(e) => setTMin(e.target.value)}
              aria-label="Minutes" className="w-11 px-1.5 text-center tabular-nums" />
            <span className="text-th-hi3 text-[10px]" aria-hidden="true">m</span>
            <Input size="xs" type="number" min={0} max={59} value={tSec} onChange={(e) => setTSec(e.target.value)}
              aria-label="Seconds" className="w-11 px-1.5 text-center tabular-nums" />
            <span className="text-th-hi3 text-[10px]" aria-hidden="true">s</span>
            <IconButton label="Add timer" size="sm" variant="subtle" onClick={submitTimer}>
              <Plus size={14} />
            </IconButton>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
            {timers.length === 0 ? (
              <EmptyState compact title="No timers" />
            ) : (
              timers.map((t) => {
                const remaining = t.running && t.endsAt != null ? Math.max(0, t.endsAt - now) : t.remainingMs;
                const done = remaining <= 0;
                return (
                  <Card key={t.id} variant="inset" padding="none" className="group flex items-center gap-2 px-2 py-1.5">
                    <div className="flex flex-col min-w-0 flex-1">
                      {t.label && <span className="text-th-hi3 text-[10px] truncate">{t.label}</span>}
                      <span className={cn('text-xl tabular-nums leading-none', done ? 'text-th-accent' : 'text-th-hi')}>
                        {fmtDuration(remaining)}
                      </span>
                    </div>
                    <IconButton
                      label={t.running ? 'Pause' : done ? 'Reset' : 'Start'}
                      size="xs"
                      onClick={() => (t.running ? pauseTimer(t.id) : done ? resetTimer(t.id) : startTimer(t.id))}
                    >
                      {t.running ? <Pause size={14} /> : done ? <RotateCcw size={14} /> : <Play size={14} />}
                    </IconButton>
                    {!done && (
                      <IconButton label="Reset" size="xs" onClick={() => resetTimer(t.id)}><RotateCcw size={13} /></IconButton>
                    )}
                    <IconButton label="Delete" size="xs" tone="danger" onClick={() => removeTimer(t.id)}><X size={13} /></IconButton>
                  </Card>
                );
              })
            )}
          </div>
        </TabPanel>

        <TabPanel value="alarm" className="flex-1 min-h-0 flex flex-col gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <Input size="xs" value={aLabel} onChange={(e) => setALabel(e.target.value)} placeholder="Label"
              aria-label="Alarm label" className="flex-1" />
            <Input size="xs" type="time" value={aTime} onChange={(e) => setATime(e.target.value)}
              aria-label="Alarm time" className="w-auto tabular-nums" />
            <IconButton label="Add alarm" size="sm" variant="subtle" onClick={submitAlarm} disabled={!aTime}>
              <Plus size={14} />
            </IconButton>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
            {alarms.length === 0 ? (
              <EmptyState compact title="No alarms" />
            ) : (
              alarms.map((a) => (
                <Card key={a.id} variant="inset" padding="none" className="group flex items-center gap-2 px-2 py-1.5">
                  <Bell size={13} className={cn('shrink-0', a.done ? 'text-th-hi3' : 'text-th-accent')} />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className={cn('text-sm tabular-nums leading-tight', a.done ? 'text-th-hi3 line-through' : 'text-th-hi')}>
                      {fmtAlarm(a.at, clock24h)}
                    </span>
                    {a.label && <span className="text-th-hi3 text-[10px] truncate">{a.label}</span>}
                  </div>
                  <span className={cn('text-[10px] shrink-0', a.done ? 'text-th-warn' : 'text-th-hi3')}>
                    {a.done ? 'rang' : relTimeUntil(a.at, now)}
                  </span>
                  <IconButton label="Delete" size="xs" tone="danger" onClick={() => removeAlarm(a.id)}><X size={13} /></IconButton>
                </Card>
              ))
            )}
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
