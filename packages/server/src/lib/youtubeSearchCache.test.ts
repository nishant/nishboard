import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { YoutubeSearchPage } from '@dash/shared';
import {
  ALL_TTL_MS,
  DAILY_SEARCH_LIMIT,
  LIVE_TTL_MS,
  MAX_ENTRIES,
  YoutubeSearchCache,
  normalizeQuery,
  searchKey,
  ttlFor,
} from './youtubeSearchCache';

const page = (id: string): YoutubeSearchPage => ({
  nextPageToken: null,
  items: [{ videoId: id, title: id, channelTitle: 'c', thumbnailUrl: '', publishedAt: '2026-01-01T00:00:00Z', durationSeconds: 120, isShort: false }],
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cache-'));
  file = path.join(dir, 'sub', 'cache.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('keys', () => {
  it('normalizes whitespace and case', () => {
    expect(normalizeQuery('  Foo   BAR ')).toBe('foo bar');
    expect(searchKey('  Foo  Bar ', true, 'tok')).toBe('foo bar|1|tok');
    expect(searchKey('x', false)).toBe('x|0|');
  });

  it('picks the TTL by mode', () => {
    expect(ttlFor(true)).toBe(LIVE_TTL_MS);
    expect(ttlFor(false)).toBe(ALL_TTL_MS);
  });
});

describe('YoutubeSearchCache', () => {
  it('respects the live (2h) and all (24h) TTLs', () => {
    const c = new YoutubeSearchCache(file);
    const t0 = Date.parse('2026-06-01T12:00:00Z');
    c.put('a|1|', 'a', true, '', page('a'), t0);
    c.put('b|0|', 'b', false, '', page('b'), t0);
    const h = 3_600_000;
    expect(c.get('a|1|', LIVE_TTL_MS, t0 + h)?.page.items[0].videoId).toBe('a');
    expect(c.get('a|1|', LIVE_TTL_MS, t0 + 2 * h)).toBeNull();
    expect(c.get('b|0|', ALL_TTL_MS, t0 + 23 * h)?.fetchedAt).toBe(new Date(t0).toISOString());
    expect(c.get('b|0|', ALL_TTL_MS, t0 + 24 * h)).toBeNull();
    expect(c.get('missing', ALL_TTL_MS, t0)).toBeNull();
  });

  it('trims to the newest 500 entries', () => {
    const c = new YoutubeSearchCache(file);
    const t0 = Date.parse('2026-06-01T00:00:00Z');
    for (let i = 0; i < MAX_ENTRIES + 5; i++) c.put(`k${i}`, `k${i}`, false, '', page(`v${i}`), t0 + i * 1000);
    const now = t0 + 10_000_000;
    expect(c.get('k0', ALL_TTL_MS, now)).toBeNull();
    expect(c.get('k4', ALL_TTL_MS, now)).toBeNull();
    expect(c.get('k5', ALL_TTL_MS, now)).not.toBeNull();
    expect(c.get(`k${MAX_ENTRIES + 4}`, ALL_TTL_MS, now)).not.toBeNull();
  });

  it('survives a restart through the file', () => {
    const c = new YoutubeSearchCache(file);
    const now = Date.now();
    c.put('q|0|', 'q', false, '', page('z'), now);
    expect(c.takeSearch(now)).toBe(true);
    c.flush();
    expect(fs.existsSync(file)).toBe(true);

    const again = new YoutubeSearchCache(file);
    expect(again.get('q|0|', ALL_TTL_MS, now)?.page.items[0].videoId).toBe('z');
    expect(again.searchesLeft(now)).toBe(DAILY_SEARCH_LIMIT - 1);
  });

  it('starts empty on a corrupt file', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    const c = new YoutubeSearchCache(file);
    expect(c.get('q|0|', ALL_TTL_MS)).toBeNull();
    expect(c.searchesLeft()).toBe(DAILY_SEARCH_LIMIT);
  });

  it('allows DAILY_SEARCH_LIMIT (55) searches a day, then resets at midnight Pacific', () => {
    expect(DAILY_SEARCH_LIMIT).toBe(55);
    const c = new YoutubeSearchCache(file);
    // 2026-06-02 06:00 UTC = 2026-06-01 23:00 PDT; 07:00 UTC is midnight PDT (08:00 UTC in winter).
    const before = Date.parse('2026-06-02T06:00:00Z');
    for (let i = 0; i < DAILY_SEARCH_LIMIT; i++) expect(c.takeSearch(before)).toBe(true);
    expect(c.takeSearch(before)).toBe(false);
    expect(c.searchesLeft(before)).toBe(0);
    expect(c.takeSearch(Date.parse('2026-06-02T06:59:00Z'))).toBe(false);
    const after = Date.parse('2026-06-02T07:01:00Z');
    expect(c.searchesLeft(after)).toBe(DAILY_SEARCH_LIMIT);
    expect(c.takeSearch(after)).toBe(true);
    expect(c.searchesLeft(after)).toBe(DAILY_SEARCH_LIMIT - 1);
  });
});
