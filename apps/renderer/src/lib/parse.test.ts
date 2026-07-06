import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextOccurrence, parseDateArg, parseDuration, parseTimeOfDay } from './parse';

// 2026 is not a leap year (neither is 2027) — date tests pin the clock here.
const MONDAY_NOON = new Date(2026, 5, 15, 12, 0, 0); // Jun 15 2026, 12:00 local

function freezeAt(date: Date): void {
  vi.useFakeTimers();
  vi.setSystemTime(date);
}

afterEach(() => vi.useRealTimers());

describe('parseDuration', () => {
  it.each<[string, number]>([
    ['1h5m3s', 3_903_000],
    ['1h 5m 3s', 3_903_000],
    ['1h 5m', 3_900_000],
    ['90m', 5_400_000],
    ['45s', 45_000],
    ['1.5h', 5_400_000],
    ['25 min', 1_500_000],
    ['2 hours', 7_200_000],
    ['1 minute', 60_000],
    ['1:30:00', 5_400_000],
    ['1:30', 90_000],
    ['1:5', 65_000],
    ['90', 5_400_000], // bare number = minutes
    ['  10 M  ', 600_000], // case/whitespace-insensitive
  ])('parses %j → %i ms', (input, ms) => {
    expect(parseDuration(input)).toBe(ms);
  });

  it.each(['', '   ', '0m', '0', '0:00', '0.5s', 'abc', '5x', 'h', '1h tea', '1:75', '1:30:99', 'm5'])(
    'rejects %j',
    (input) => {
      expect(parseDuration(input)).toBeNull();
    },
  );
});

describe('parseTimeOfDay', () => {
  it.each<[string, { h: number; m: number }]>([
    ['7', { h: 7, m: 0 }],
    ['7am', { h: 7, m: 0 }],
    ['7:30', { h: 7, m: 30 }],
    ['7:30pm', { h: 19, m: 30 }],
    ['7:30 PM', { h: 19, m: 30 }],
    ['19:05', { h: 19, m: 5 }],
    ['12am', { h: 0, m: 0 }],
    ['12pm', { h: 12, m: 0 }],
    ['0:15', { h: 0, m: 15 }],
    ['23:59', { h: 23, m: 59 }],
  ])('parses %j', (input, out) => {
    expect(parseTimeOfDay(input)).toEqual(out);
  });

  it.each(['', '24:00', '13pm', '0am', '7:60', '7:5', 'noon', '7 30'])('rejects %j', (input) => {
    expect(parseTimeOfDay(input)).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('resolves to today while the time is still ahead', () => {
    freezeAt(MONDAY_NOON);
    // "7:30pm" typed at noon → tonight, not tomorrow.
    const tod = parseTimeOfDay('7:30pm');
    expect(tod).toEqual({ h: 19, m: 30 });
    expect(nextOccurrence(19, 30)).toBe(new Date(2026, 5, 15, 19, 30).getTime());
  });

  it('rolls to tomorrow once the time has passed', () => {
    freezeAt(new Date(2026, 5, 15, 21, 0, 0));
    expect(nextOccurrence(19, 30)).toBe(new Date(2026, 5, 16, 19, 30).getTime());
  });
});

describe('parseDateArg', () => {
  it.each<[string, Date]>([
    ['12/25', new Date(2026, 11, 25)],
    ['3/1', new Date(2027, 2, 1)], // already passed this year → rolls over
    ['12/25/2027', new Date(2027, 11, 25)],
    ['2026-12-25', new Date(2026, 11, 25)],
    ['12/25 7:30pm', new Date(2026, 11, 25, 19, 30)],
    ['2026-12-25 19:05', new Date(2026, 11, 25, 19, 5)],
    ['2/29/2028', new Date(2028, 1, 29)], // leap year — valid
  ])('parses %j', (input, date) => {
    freezeAt(MONDAY_NOON);
    expect(parseDateArg(input)).toBe(date.getTime());
  });

  it.each(['', '2/30', '2/29', '2/29/2026', '13/1', '0/5', '12/32', '12/25/27', 'tomorrow', '12/25 25:00'])(
    'rejects %j',
    (input) => {
      freezeAt(MONDAY_NOON); // 2026 — 2/29 is invalid in a non-leap year
      expect(parseDateArg(input)).toBeNull();
    },
  );
});
