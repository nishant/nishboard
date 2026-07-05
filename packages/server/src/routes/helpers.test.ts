import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fnv1a } from './weather';
import { downsample } from './crypto';
import { isMarketOpen } from './stocks';

describe('fnv1a (NWS alert-id fallback)', () => {
  it('matches the reference FNV-1a 32-bit values', () => {
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('')).toBe('811c9dc5'); // offset basis
  });

  it('is stable and content-sensitive (dedupe identity)', () => {
    const key = 'Severe Thunderstorm Warning|Wind gusts to 70mph';
    expect(fnv1a(key)).toBe(fnv1a(key));
    expect(fnv1a(key)).not.toBe(fnv1a(`${key} `));
  });
});

describe('downsample (7d sparkline)', () => {
  it('keeps every step-th point starting at index 0', () => {
    expect(downsample([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([0, 4, 8]);
    expect(downsample([1, 2, 3, 4], 2)).toEqual([1, 3]);
    expect(downsample([])).toEqual([]);
  });
});

describe('isMarketOpen (NYSE regular session, America/New_York)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (iso: string) => {
    vi.setSystemTime(new Date(iso));
    return isMarketOpen();
  };

  it('is open during a weekday session (EDT: UTC-4)', () => {
    expect(at('2026-07-01T14:00:00Z')).toBe(true); // Wed 10:00 ET
    expect(at('2026-07-01T13:30:00Z')).toBe(true); // Wed 09:30 ET — opening bell
    expect(at('2026-07-01T19:59:00Z')).toBe(true); // Wed 15:59 ET
  });

  it('is closed before the bell, at/after close, and on weekends', () => {
    expect(at('2026-07-01T13:29:00Z')).toBe(false); // Wed 09:29 ET
    expect(at('2026-07-01T20:00:00Z')).toBe(false); // Wed 16:00 ET — close
    expect(at('2026-07-04T15:00:00Z')).toBe(false); // Saturday
    expect(at('2026-07-05T15:00:00Z')).toBe(false); // Sunday
  });

  it('handles EST (winter, UTC-5)', () => {
    expect(at('2026-01-14T14:00:00Z')).toBe(false); // Wed 09:00 ET — pre-open
    expect(at('2026-01-14T15:00:00Z')).toBe(true); // Wed 10:00 ET
  });
});
