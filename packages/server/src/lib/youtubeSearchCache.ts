import fs from 'fs';
import os from 'os';
import path from 'path';
import type { YoutubeSearchPage } from '@dash/shared';
import { writePrivateFile } from './tokenCrypto';

const HOUR = 3_600_000;
/** How long a saved Live-now search is reused. */
export const LIVE_TTL_MS = 2 * HOUR;
/** How long a saved All-videos search is reused. */
export const ALL_TTL_MS = 24 * HOUR;
/** The most saved searches kept; the oldest are dropped first. */
export const MAX_ENTRIES = 500;
/** Each search costs 100 of the 10,000 daily units (shared with another app); stay under the real limit. */
export const DAILY_SEARCH_LIMIT = 90;

export const ttlFor = (live: boolean): number => (live ? LIVE_TTL_MS : ALL_TTL_MS);

/** Lowercase, trim and collapse inner whitespace, so "  Foo   Bar " and "foo bar" share an entry. */
export function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The entry key: normalized query, live flag and page token. */
export function searchKey(q: string, live: boolean, pageToken = ''): string {
  return `${normalizeQuery(q)}|${live ? 1 : 0}|${pageToken}`;
}

interface Entry {
  q: string;
  live: boolean;
  pageToken: string;
  page: YoutubeSearchPage;
  fetchedAt: string;
}

interface CacheFile {
  version: 1;
  entries: Record<string, Entry>;
  budget: { day: string; used: number };
}

const emptyFile = (): CacheFile => ({ version: 1, entries: {}, budget: { day: '', used: 0 } });

// YouTube's quota resets at midnight Pacific.
const PACIFIC_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
const pacificDay = (now: number): string => PACIFIC_DAY.format(new Date(now));

export function defaultCachePath(): string {
  return path.join(os.homedir(), '.dash', 'youtube_search_cache.json');
}

/** Public YouTube search results plus the daily search count, kept in a JSON
 *  file so both survive restarts. Holds no secrets (never the API key). */
export class YoutubeSearchCache {
  private data: CacheFile | null = null;
  private warned = false;

  constructor(private readonly file: string) {}

  private load(): CacheFile {
    if (this.data) return this.data;
    let loaded = emptyFile();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<CacheFile> | null;
      if (raw && raw.version === 1 && raw.entries && typeof raw.entries === 'object') {
        loaded = {
          version: 1,
          entries: raw.entries,
          budget: {
            day: typeof raw.budget?.day === 'string' ? raw.budget.day : '',
            used: typeof raw.budget?.used === 'number' ? raw.budget.used : 0,
          },
        };
      }
    } catch {
      // missing or corrupt file → start empty
    }
    this.data = loaded;
    return loaded;
  }

  /** The saved page, or null when there is none or it is older than `ttlMs`. */
  get(key: string, ttlMs: number, now = Date.now()): { page: YoutubeSearchPage; fetchedAt: string } | null {
    const entry = this.load().entries[key];
    if (!entry || !entry.page || !Array.isArray(entry.page.items)) return null;
    const at = Date.parse(entry.fetchedAt);
    if (!Number.isFinite(at) || now - at >= ttlMs) return null;
    return { page: entry.page, fetchedAt: entry.fetchedAt };
  }

  /** Saves (or rewrites) a page, then trims to MAX_ENTRIES. */
  put(key: string, q: string, live: boolean, pageToken: string, page: YoutubeSearchPage, now = Date.now()): void {
    const data = this.load();
    data.entries[key] = { q: normalizeQuery(q), live, pageToken, page, fetchedAt: new Date(now).toISOString() };
    const keys = Object.keys(data.entries);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => Date.parse(data.entries[b].fetchedAt) - Date.parse(data.entries[a].fetchedAt));
      for (const k of keys.slice(MAX_ENTRIES)) delete data.entries[k];
    }
    this.flush();
  }

  /** Gives back a search YouTube never charged for (it did not answer). */
  refundSearch(now = Date.now()): void {
    const used = this.usedToday(now);
    if (used === 0) return;
    this.load().budget = { day: pacificDay(now), used: used - 1 };
    this.flush();
  }

  private usedToday(now: number): number {
    const { budget } = this.load();
    return budget.day === pacificDay(now) ? budget.used : 0;
  }

  /** Searches still allowed today (Pacific day). */
  searchesLeft(now = Date.now()): number {
    return Math.max(0, DAILY_SEARCH_LIMIT - this.usedToday(now));
  }

  /** Spends one search from today's budget; false when it is spent. */
  takeSearch(now = Date.now()): boolean {
    const used = this.usedToday(now);
    if (used >= DAILY_SEARCH_LIMIT) return false;
    this.load().budget = { day: pacificDay(now), used: used + 1 };
    this.flush();
    return true;
  }

  /** Writes the file now (every change does: at most ~90 searches a day, and the
   *  server is killed outright on quit or a credential save, so a delayed write
   *  would be lost). A failure is logged once; the in-memory copy keeps serving. */
  flush(): void {
    if (!this.data) return;
    try {
      writePrivateFile(this.file, JSON.stringify(this.data));
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        console.warn(`[youtube] could not save the search cache: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
