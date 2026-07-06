import { useState, useEffect, useMemo } from 'react';
import { LogIn, LogOut, X } from 'lucide-react';
import type { CalendarEventData } from '@dash/shared';
import { useElementSize } from '../../hooks/useElementSize';
import { HeaderAction } from '../../components/HeaderAction';
import {
  useCalendarAuthStatus, useCalendarConnect, useCalendarLogout,
  useCalendarEvents, useAddCalendarEvent,
} from './useCalendarEvents';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Returns array of 42 cells (6 full weeks): null for padding, number for day-of-month
function buildGrid(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null); // always 6 rows
  return cells;
}

/** Local y/m(0-based)/d → YYYY-MM-DD. */
function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** YYYY-MM-DD → local midnight Date. */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Every local calendar day an event touches, as YYYY-MM-DD.
 *  All-day events: start/end are plain dates and end is EXCLUSIVE (Google).
 *  Timed events: end is inclusive, except an end exactly at local midnight
 *  doesn't spill a dot onto the next day. */
function eventDaySpan(ev: CalendarEventData): string[] {
  const days: string[] = [];
  let cur: Date;
  let lastExclusive: Date;
  if (ev.allDay) {
    cur = parseLocalDate(ev.start);
    lastExclusive = parseLocalDate(ev.end);
    if (!(cur < lastExclusive)) return [ev.start]; // defensive: degenerate span
  } else {
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (end.getTime() === endDay.getTime() && end > start) endDay.setDate(endDay.getDate() - 1);
    lastExclusive = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate() + 1);
    if (!(cur < lastExclusive)) return [toIso(cur.getFullYear(), cur.getMonth(), cur.getDate())];
  }
  while (cur < lastExclusive && days.length < 370) {
    days.push(toIso(cur.getFullYear(), cur.getMonth(), cur.getDate()));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function bucketEvents(events: CalendarEventData[]): Map<string, CalendarEventData[]> {
  const byDay = new Map<string, CalendarEventData[]>();
  for (const ev of events) {
    for (const iso of eventDaySpan(ev)) {
      const list = byDay.get(iso);
      if (list) list.push(ev);
      else byDay.set(iso, [ev]);
    }
  }
  return byDay;
}

function MonthView({
  year, month, todayYear, todayMonth, todayDate, onDayClick, eventDays,
}: {
  year: number; month: number;
  todayYear: number; todayMonth: number; todayDate: number;
  onDayClick: (iso: string) => void;
  eventDays: Set<string>;
}) {
  const cells = buildGrid(year, month);
  const label = new Date(year, month, 1).toLocaleString('default', { month: 'long' });
  const isCurrent = year === todayYear && month === todayMonth;

  return (
    <div className="flex flex-col min-w-0 min-h-0">
      <p className={`text-[11px] font-semibold text-center mb-1.5 shrink-0 ${isCurrent ? 'text-th-hi' : 'text-th-3'}`}>
        {label} {year}
      </p>
      <div className="grid grid-cols-7 shrink-0 mb-0.5">
        {DOW.map((d) => (
          <span key={d} className="text-center text-[9px] font-medium text-th-ghost uppercase tracking-wide">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {cells.map((d, i) => {
          const isToday = isCurrent && d === todayDate;
          const iso = d === null ? null : toIso(year, month, d);
          return (
            <div
              key={i}
              onClick={iso === null ? undefined : () => onDayClick(iso)}
              className={`relative flex items-center justify-center text-[11px] h-6 rounded-full ${
                d === null ? 'invisible' :
                isToday ? 'bg-th-invert-bg text-th-invert-text font-bold cursor-pointer' :
                'text-th-2 cursor-pointer hover:bg-th-elevated'
              }`}
            >
              {d ?? ''}
              {iso !== null && eventDays.has(iso) && (
                <span
                  className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 w-[3px] h-[3px] rounded-full ${
                    isToday ? 'bg-th-invert-text' : 'bg-th-hi'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayPanel({
  iso, events, authed, onClose,
}: {
  iso: string;
  events: CalendarEventData[];
  authed: boolean;
  onClose: () => void;
}) {
  const connect = useCalendarConnect();
  const addEvent = useAddCalendarEvent();
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');

  const heading = parseLocalDate(iso).toLocaleDateString('default', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);

  const submit = () => {
    const summary = title.trim();
    if (!summary || addEvent.isPending) return;
    addEvent.mutate(
      time ? { summary, date: iso, time } : { summary, date: iso },
      { onSuccess: () => { setTitle(''); setTime(''); } },
    );
  };

  return (
    <div className="absolute inset-0 z-20 bg-th-surface/95 backdrop-blur-sm rounded-lg p-3 flex flex-col">
      <div className="flex items-center justify-between shrink-0 mb-2">
        <p className="text-[12px] font-semibold text-th-hi">{heading}</p>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close day view"
          className="flex items-center justify-center w-[22px] h-[22px] rounded text-th-ghost hover:text-th-hi hover:bg-th-elevated/60 transition-colors"
        >
          <X size={12} />
        </button>
      </div>
      {!authed ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
          <p className="text-th-ghost text-xs">
            Connect your Google account to see and add events
          </p>
          <button
            onClick={() => connect.mutate()}
            className="px-3 py-1.5 rounded-full bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
          >
            Connect Google Calendar
          </button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
            {allDay.map((e) => (
              <div key={e.id} className="px-2 py-1 rounded bg-th-elevated text-[11px] text-th-hi">
                {e.title}
                {e.location && <span className="text-th-ghost ml-1.5">{e.location}</span>}
              </div>
            ))}
            {timed.map((e) => (
              <div key={e.id} className="flex items-baseline gap-1.5 px-0.5 text-[11px]">
                <span className="text-th-3 tabular-nums shrink-0">
                  {new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-th-2 truncate">{e.title}</span>
                {e.location && <span className="text-th-ghost truncate">{e.location}</span>}
              </div>
            ))}
            {events.length === 0 && <p className="text-th-ghost text-xs">No events</p>}
          </div>
          <form
            className="shrink-0 flex items-center gap-1.5 mt-2"
            onSubmit={(e) => { e.preventDefault(); submit(); }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="New event…"
              className="flex-1 min-w-0 px-2 py-1 rounded bg-th-elevated text-[11px] text-th-hi placeholder:text-th-ghost outline-none"
            />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="px-1.5 py-1 rounded bg-th-elevated text-[11px] text-th-2 outline-none"
            />
            <button
              type="submit"
              disabled={addEvent.isPending || title.trim() === ''}
              className="px-2.5 py-1 rounded bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              Add
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/** WidgetShell header action (via DashboardGrid): Connect when signed out,
 *  disconnect when in — mirrors YoutubeActions. */
export function CalendarActions() {
  const { data } = useCalendarAuthStatus();
  const connect = useCalendarConnect();
  const logout = useCalendarLogout();
  if (data?.authenticated) {
    return (
      <HeaderAction title="Disconnect Google Calendar" danger onClick={() => logout.mutate()}>
        <LogOut size={12} />
      </HeaderAction>
    );
  }
  return (
    <HeaderAction title="Connect Google Calendar (Google account)" onClick={() => connect.mutate()}>
      <LogIn size={12} />
    </HeaderAction>
  );
}

export function CalendarWidget() {
  const MIN_W = 155; // px — min width per month column
  const MIN_H = 195; // px — min height per month row

  const { ref: setContainerEl, width, height } = useElementSize<HTMLDivElement>();
  const cols = Math.max(1, Math.floor(width / MIN_W));
  const rows = Math.max(1, Math.floor(height / MIN_H));

  // Re-render at midnight: without a tick the today-highlight (and the visible
  // month range) stays on yesterday until a resize/remount forces a render.
  const [dateKey, setDateKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const id = setInterval(() => {
      const key = new Date().toDateString();
      setDateKey((prev) => (prev === key ? prev : key));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const today = new Date(dateKey);
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  const numMonths = cols * rows;

  // With 1-2 months start at current; with 3+ anchor so current is second
  const startOffset = numMonths >= 3 ? -1 : 0;

  const months = Array.from({ length: numMonths }, (_, i) => {
    let m = todayMonth + startOffset + i;
    let y = todayYear;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    return { year: y, month: m };
  });

  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const authed = useCalendarAuthStatus().data?.authenticated === true;

  // ONE events query covering the whole visible range (first day of the first
  // month → last day of the last), enabled only when signed in — a signed-out
  // day click must never fire it.
  const first = months[0];
  const last = months[months.length - 1];
  const rangeStart = toIso(first.year, first.month, 1);
  const rangeEnd = toIso(last.year, last.month, new Date(last.year, last.month + 1, 0).getDate());
  const { data: eventsData } = useCalendarEvents(rangeStart, rangeEnd, authed);

  const eventsByDay = useMemo(
    () => bucketEvents(eventsData?.events ?? []),
    [eventsData],
  );
  const eventDays = useMemo(() => new Set(eventsByDay.keys()), [eventsByDay]);

  return (
    <div ref={setContainerEl} className="relative h-full p-3 overflow-hidden">
      <div
        className="h-full"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: '16px',
        }}
      >
        {months.map(({ year, month }) => (
          <MonthView
            key={`${year}-${month}`}
            year={year}
            month={month}
            todayYear={todayYear}
            todayMonth={todayMonth}
            todayDate={todayDate}
            onDayClick={setSelectedDay}
            eventDays={eventDays}
          />
        ))}
      </div>
      {selectedDay !== null && (
        <DayPanel
          iso={selectedDay}
          events={eventsByDay.get(selectedDay) ?? []}
          authed={authed}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}
