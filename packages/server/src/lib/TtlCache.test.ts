import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache } from './TtlCache';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TtlCache', () => {
  it('returns values until the TTL elapses, then misses (and evicts)', () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set('a', 1);
    vi.advanceTimersByTime(999);
    expect(cache.get('a')).toBe(1);
    vi.advanceTimersByTime(1);
    expect(cache.get('a')).toBeNull();
  });

  it('honors a per-entry TTL override', () => {
    const cache = new TtlCache<string, number>(1000);
    cache.set('long', 1, 5000);
    vi.advanceTimersByTime(2000);
    expect(cache.get('long')).toBe(1);
  });

  it('evicts the stalest key (FIFO by recency) at the cap', () => {
    const cache = new TtlCache<string, number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // cap hit — 'a' is oldest
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });

  it('re-setting a key refreshes its recency', () => {
    const cache = new TtlCache<string, number>(60_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 10); // 'a' becomes newest → 'b' is now oldest
    cache.set('c', 3);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).toBe(10);
    expect(cache.get('c')).toBe(3);
  });

  it('delete and clear remove entries', () => {
    const cache = new TtlCache<string, number>(60_000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.delete('a');
    expect(cache.get('a')).toBeNull();
    cache.clear();
    expect(cache.get('b')).toBeNull();
  });
});
