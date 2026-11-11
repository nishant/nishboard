import { describe, expect, it } from 'vitest';
import type { CalendarEventData } from '@dash/shared';
import { buildGrid, bucketEvents, eventDaySpan } from './calendarGrid';

function ev(over: Partial<CalendarEventData>): CalendarEventData {
  return { id: 'e', title: 'T', start: '', end: '', allDay: false, ...over };
}

// Timed events use local-time strings (no Z) so the result is TZ-independent.
describe('eventDaySpan', () => {
  it('an all-day single day covers just that day (end is exclusive)', () => {
    expect(eventDaySpan(ev({ allDay: true, start: '2026-11-10', end: '2026-11-11' }))).toEqual(['2026-11-10']);
  });

  it('an all-day 3-day span covers three days, not four', () => {
    expect(eventDaySpan(ev({ allDay: true, start: '2026-11-29', end: '2026-12-02' })))
      .toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
  });

  it('a timed event ending exactly at 00:00 does not spill onto the next day', () => {
    expect(eventDaySpan(ev({ start: '2026-11-10T22:00:00', end: '2026-11-11T00:00:00' }))).toEqual(['2026-11-10']);
  });

  it('an overnight timed event touches both days', () => {
    expect(eventDaySpan(ev({ start: '2026-11-10T22:00:00', end: '2026-11-11T02:00:00' })))
      .toEqual(['2026-11-10', '2026-11-11']);
  });

  it('a timed event within one day stays on that day', () => {
    expect(eventDaySpan(ev({ start: '2026-11-10T09:00:00', end: '2026-11-10T10:00:00' }))).toEqual(['2026-11-10']);
  });
});

describe('bucketEvents', () => {
  it('lists a multi-day event under every day it touches', () => {
    const e = ev({ id: 'a', allDay: true, start: '2026-11-10', end: '2026-11-12' });
    const b = bucketEvents([e, ev({ id: 'b', allDay: true, start: '2026-11-11', end: '2026-11-12' })]);
    expect([...b.keys()]).toEqual(['2026-11-10', '2026-11-11']);
    expect(b.get('2026-11-11')?.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('buildGrid', () => {
  it('is always 42 cells, padded before the 1st weekday and after the last day', () => {
    const cells = buildGrid(2026, 10); // Nov 2026 starts on a Sunday, 30 days
    expect(cells).toHaveLength(42);
    expect(cells[0]).toBe(1);
    expect(cells[29]).toBe(30);
    expect(cells[30]).toBeNull();
  });
});
