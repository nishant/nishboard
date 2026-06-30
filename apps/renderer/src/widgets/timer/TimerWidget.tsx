import { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw, X, Plus, Bell } from 'lucide-react';
import { useTimersStore } from '../../store/timersStore';
import { fireAlert } from '../../lib/alerts';
import { cn } from '../../lib/utils';

type Tab = 'timer' | 'alarm';

function fmtDur(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtAlarm(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}

function relTime(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

function timeToTimestamp(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  let at = d.getTime();
  if (at <= Date.now()) at += 24 * 3600 * 1000; // next occurrence
  return at;
}

const iconBtn = 'shrink-0 p-1 rounded text-th-ghost hover:text-th-2 hover:bg-th-elevated/60 transition disabled:opacity-30 disabled:cursor-not-allowed';

export function TimerWidget() {
  const [tab, setTab] = useState<Tab>('timer');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {/* Tabs */}
      <div className="flex rounded-lg bg-th-elevated p-0.5 shrink-0 self-start">
        {(['timer', 'alarm'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn('px-2.5 py-0.5 rounded text-[10px] capitalize transition-colors',
              tab === t ? 'bg-th-overlay text-th-hi' : 'text-th-ghost hover:text-th-2')}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'timer' ? (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <input value={tLabel} onChange={(e) => setTLabel(e.target.value)} placeholder="Label"
              className="flex-1 min-w-0 bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[11px] placeholder:text-th-ghost focus:outline-none focus:border-th-3" />
            <input type="number" min={0} value={tMin} onChange={(e) => setTMin(e.target.value)} title="minutes"
              className="w-10 bg-th-elevated border border-th-line rounded-lg px-1.5 py-1.5 text-th-hi text-[11px] text-center tabular-nums focus:outline-none focus:border-th-3" />
            <span className="text-th-ghost text-[10px]">m</span>
            <input type="number" min={0} max={59} value={tSec} onChange={(e) => setTSec(e.target.value)} title="seconds"
              className="w-10 bg-th-elevated border border-th-line rounded-lg px-1.5 py-1.5 text-th-hi text-[11px] text-center tabular-nums focus:outline-none focus:border-th-3" />
            <span className="text-th-ghost text-[10px]">s</span>
            <button onClick={submitTimer} className="shrink-0 p-1.5 rounded-lg bg-th-overlay hover:bg-th-overlay/70 text-th-hi transition-colors" title="Add timer">
              <Plus size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
            {timers.length === 0 ? (
              <div className="h-full flex items-center justify-center text-th-ghost text-xs">No timers</div>
            ) : (
              timers.map((t) => {
                const remaining = t.running && t.endsAt != null ? Math.max(0, t.endsAt - now) : t.remainingMs;
                const done = remaining <= 0;
                return (
                  <div key={t.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-th-elevated/40">
                    <div className="flex flex-col min-w-0 flex-1">
                      {t.label && <span className="text-th-ghost text-[10px] truncate">{t.label}</span>}
                      <span className={cn('text-xl tabular-nums leading-none', done ? 'text-th-accent' : 'text-th-hi')}>
                        {fmtDur(remaining)}
                      </span>
                    </div>
                    <button
                      onClick={() => (t.running ? pauseTimer(t.id) : done ? resetTimer(t.id) : startTimer(t.id))}
                      className={iconBtn}
                      title={t.running ? 'Pause' : done ? 'Reset' : 'Start'}
                    >
                      {t.running ? <Pause size={14} /> : done ? <RotateCcw size={14} /> : <Play size={14} />}
                    </button>
                    {!done && (
                      <button onClick={() => resetTimer(t.id)} className={iconBtn} title="Reset"><RotateCcw size={13} /></button>
                    )}
                    <button onClick={() => removeTimer(t.id)} className={iconBtn} title="Delete"><X size={13} /></button>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1 shrink-0">
            <input value={aLabel} onChange={(e) => setALabel(e.target.value)} placeholder="Label"
              className="flex-1 min-w-0 bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[11px] placeholder:text-th-ghost focus:outline-none focus:border-th-3" />
            <input type="time" value={aTime} onChange={(e) => setATime(e.target.value)}
              className="bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[11px] tabular-nums focus:outline-none focus:border-th-3" />
            <button onClick={submitAlarm} disabled={!aTime} className="shrink-0 p-1.5 rounded-lg bg-th-overlay hover:bg-th-overlay/70 text-th-hi disabled:opacity-40 disabled:cursor-not-allowed transition-colors" title="Add alarm">
              <Plus size={14} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
            {alarms.length === 0 ? (
              <div className="h-full flex items-center justify-center text-th-ghost text-xs">No alarms</div>
            ) : (
              alarms.map((a) => (
                <div key={a.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-th-elevated/40">
                  <Bell size={13} className={cn('shrink-0', a.done ? 'text-th-ghost' : 'text-th-accent')} />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className={cn('text-sm tabular-nums leading-tight', a.done ? 'text-th-ghost line-through' : 'text-th-hi')}>
                      {fmtAlarm(a.at)}
                    </span>
                    {a.label && <span className="text-th-ghost text-[10px] truncate">{a.label}</span>}
                  </div>
                  <span className={cn('text-[10px] shrink-0', a.done ? 'text-amber-500/70' : 'text-th-ghost')}>
                    {a.done ? 'rang' : relTime(a.at, now)}
                  </span>
                  <button onClick={() => removeAlarm(a.id)} className={iconBtn} title="Delete"><X size={13} /></button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
