// Pure calendar-grid helpers (no React), split out so the date rules are unit-testable.
import type { CalendarEventData } from '@dash/shared';

/** 42 cells (6 full weeks): null for padding, number for day-of-month.
 *  Exported for tests. */
export function buildGrid(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null); // always 6 rows
  return cells;
}

/** Local y/m(0-based)/d → YYYY-MM-DD. */
/** Exported for tests. */
export function toIso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** YYYY-MM-DD → local midnight Date. */
/** Exported for tests. */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Every local calendar day an event touches, as YYYY-MM-DD.
 *  All-day events: start/end are plain dates and end is EXCLUSIVE (Google).
 *  Timed events: end is inclusive, except an end exactly at local midnight
 *  doesn't spill a dot onto the next day. */
/** Exported for tests. */
export function eventDaySpan(ev: CalendarEventData): string[] {
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

/** Exported for tests. */
export function bucketEvents(events: CalendarEventData[]): Map<string, CalendarEventData[]> {
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

