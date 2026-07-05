import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtMs, fmtRemaining, fmtUptime, hourFormat, relTimeAgo, relTimeUntil } from './time';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('fmtMs', () => {
  it('formats m:ss', () => {
    expect(fmtMs(0)).toBe('0:00');
    expect(fmtMs(65_000)).toBe('1:05');
    expect(fmtMs(10 * MIN + 9_000)).toBe('10:09');
  });
});

describe('fmtDuration', () => {
  it('formats h:mm:ss above an hour, m:ss below', () => {
    expect(fmtDuration(HOUR + MIN + 1_000)).toBe('1:01:01');
    expect(fmtDuration(5 * MIN)).toBe('5:00');
  });

  it('ceils partial seconds (countdown style) and clamps negatives', () => {
    expect(fmtDuration(59_500)).toBe('1:00');
    expect(fmtDuration(-5_000)).toBe('0:00');
  });
});

describe('fmtRemaining', () => {
  it('adapts the unit pair to the magnitude', () => {
    expect(fmtRemaining(2 * DAY + 4 * HOUR)).toBe('2d 4h');
    expect(fmtRemaining(3 * HOUR + 12 * MIN)).toBe('3h 12m');
    expect(fmtRemaining(5 * MIN + 30_000)).toBe('5m 30s');
    expect(fmtRemaining(42_000)).toBe('42s');
    expect(fmtRemaining(0)).toBe('now');
    expect(fmtRemaining(-1)).toBe('now');
  });
});

describe('relTimeAgo', () => {
  it('buckets past timestamps', () => {
    expect(relTimeAgo(new Date(Date.now() - 10_000).toISOString())).toBe('just now');
    expect(relTimeAgo(new Date(Date.now() - 5 * MIN).toISOString())).toBe('5m ago');
    expect(relTimeAgo(new Date(Date.now() - 2 * HOUR).toISOString())).toBe('2h ago');
    expect(relTimeAgo(new Date(Date.now() - 3 * DAY).toISOString())).toBe('3d ago');
  });

  it('returns empty for missing or future timestamps', () => {
    expect(relTimeAgo('')).toBe('');
    expect(relTimeAgo(new Date(Date.now() + HOUR).toISOString())).toBe('');
  });
});

describe('relTimeUntil', () => {
  const now = 1_750_000_000_000;
  it('buckets future timestamps', () => {
    expect(relTimeUntil(now + 5 * MIN, now)).toBe('in 5m');
    expect(relTimeUntil(now + 2 * HOUR + 30 * MIN, now)).toBe('in 2h 30m');
    expect(relTimeUntil(now + 3 * DAY + 4 * HOUR, now)).toBe('in 3d 4h');
    expect(relTimeUntil(now, now)).toBe('now');
  });
});

describe('hourFormat', () => {
  it('uses h23 for 24h clocks so midnight renders 00, and hour12 otherwise', () => {
    expect(hourFormat(true)).toEqual({ hourCycle: 'h23' });
    expect(hourFormat(false)).toEqual({ hour12: true });
    const midnight = new Date('2026-01-01T00:30:00');
    expect(new Intl.DateTimeFormat('en-US', { hour: 'numeric', ...hourFormat(true) }).format(midnight)).toContain('00');
  });
});

describe('fmtUptime', () => {
  it('formats seconds as d/h/m', () => {
    expect(fmtUptime(3 * 86_400 + 4 * 3_600 + 12 * 60)).toBe('3d 4h 12m');
    expect(fmtUptime(4 * 3_600 + 12 * 60)).toBe('4h 12m');
    expect(fmtUptime(12 * 60)).toBe('12m');
    expect(fmtUptime(30)).toBe('0m');
  });
});
