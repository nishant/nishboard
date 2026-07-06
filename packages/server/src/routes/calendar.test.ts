import { describe, it, expect } from 'vitest';
import { parseLocalDate, toIsoDate, mapEvent, type GoogleEventItem } from './calendar';

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD to local midnight', () => {
    const d = parseLocalDate('2026-07-06');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // 0-indexed July
    expect(d.getDate()).toBe(6);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('round-trips through toIsoDate', () => {
    for (const iso of ['2026-01-01', '2026-02-28', '2026-12-31']) {
      expect(toIsoDate(parseLocalDate(iso))).toBe(iso);
    }
  });
});

describe('toIsoDate — all-day exclusive end (+1 day) math', () => {
  // Google all-day inserts use an EXCLUSIVE end.date; the route computes it
  // as parseLocalDate(date) + 1 day. These cover the rollover edges.
  function plusOneDay(iso: string): string {
    const d = parseLocalDate(iso);
    d.setDate(d.getDate() + 1);
    return toIsoDate(d);
  }

  it('rolls over a month boundary', () => {
    expect(plusOneDay('2026-07-31')).toBe('2026-08-01');
  });

  it('rolls over a year boundary', () => {
    expect(plusOneDay('2026-12-31')).toBe('2027-01-01');
  });

  it('handles leap-year February', () => {
    expect(plusOneDay('2028-02-28')).toBe('2028-02-29');
    expect(plusOneDay('2028-02-29')).toBe('2028-03-01');
  });

  it('handles non-leap February', () => {
    expect(plusOneDay('2026-02-28')).toBe('2026-03-01');
  });

  it('zero-pads months and days', () => {
    expect(plusOneDay('2026-01-08')).toBe('2026-01-09');
    expect(plusOneDay('2026-09-30')).toBe('2026-10-01');
  });
});

describe('mapEvent', () => {
  it('maps a timed event (dateTime, allDay=false)', () => {
    const item: GoogleEventItem = {
      id: 'abc',
      summary: 'Standup',
      start: { dateTime: '2026-07-06T14:00:00-05:00' },
      end: { dateTime: '2026-07-06T14:30:00-05:00' },
    };
    expect(mapEvent(item)).toEqual({
      id: 'abc',
      title: 'Standup',
      start: '2026-07-06T14:00:00-05:00',
      end: '2026-07-06T14:30:00-05:00',
      allDay: false,
    });
  });

  it('maps an all-day event (start.date present ⇒ allDay=true)', () => {
    const item: GoogleEventItem = {
      id: 'def',
      summary: 'PTO',
      start: { date: '2026-07-06' },
      end: { date: '2026-07-07' }, // Google's exclusive end passes through as-is
    };
    const ev = mapEvent(item);
    expect(ev.allDay).toBe(true);
    expect(ev.start).toBe('2026-07-06');
    expect(ev.end).toBe('2026-07-07');
  });

  it('falls back to "(no title)" when summary is missing', () => {
    const ev = mapEvent({ id: 'x', start: { date: '2026-07-06' }, end: { date: '2026-07-07' } });
    expect(ev.title).toBe('(no title)');
  });

  it('includes location only when present', () => {
    const withLoc = mapEvent({
      id: 'y',
      summary: 'Dinner',
      location: 'Odd Duck',
      start: { dateTime: '2026-07-06T19:00:00Z' },
      end: { dateTime: '2026-07-06T21:00:00Z' },
    });
    expect(withLoc.location).toBe('Odd Duck');

    const withoutLoc = mapEvent({
      id: 'z',
      summary: 'Dinner',
      start: { dateTime: '2026-07-06T19:00:00Z' },
      end: { dateTime: '2026-07-06T21:00:00Z' },
    });
    expect('location' in withoutLoc).toBe(false);
  });

  it('never marks a dateTime event all-day even if end.date is present', () => {
    // Defensive: allDay is decided by start.date alone.
    const ev = mapEvent({
      id: 'w',
      summary: 'Weird',
      start: { dateTime: '2026-07-06T09:00:00Z' },
      end: { date: '2026-07-07' },
    });
    expect(ev.allDay).toBe(false);
  });
});
