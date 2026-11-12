import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseLocalDate, toIsoDate, mapEvent, type GoogleEventItem } from './calendar';
import { testServer } from '../test/server';
import { jsonRes, stubFetch } from '../test/fetchStub';

// In-memory token store: the real one reads/writes ~/.dash/google_calendar_tokens.json.
const fakeTokens = vi.hoisted(() => ({ tokens: null as null | { access_token: string } }));
vi.mock('../lib/userTokenStore', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../lib/userTokenStore')>();
  class FakeStore {
    get authenticated(): boolean { return fakeTokens.tokens !== null; }
    store(t: { access_token: string }): void { fakeTokens.tokens = t; }
    clear(): void { fakeTokens.tokens = null; }
    async getValidToken(): Promise<string> { return 'tok'; }
  }
  return { ...orig, UserTokenStore: FakeStore };
});

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

describe('calendar routes', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await testServer(); });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    process.env.YOUTUBE_CLIENT_ID = 'cid';
    process.env.YOUTUBE_CLIENT_SECRET = 'secret';
    fakeTokens.tokens = { access_token: 'tok' };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
    fakeTokens.tokens = null;
  });

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/calendar/events', payload });

  it('rejects impossible times and dates with 400', async () => {
    expect((await post({ summary: 'x', date: '2026-07-06', time: '25:90' })).statusCode).toBe(400);
    expect((await post({ summary: 'x', date: '2026-07-06', time: '24:00' })).statusCode).toBe(400);
    expect((await post({ summary: 'x', date: '2026-02-31' })).statusCode).toBe(400);
    expect((await post({ summary: 'x', date: '2026-13-01' })).statusCode).toBe(400);
  });

  it('rejects start after end and impossible dates on GET /events', async () => {
    const a = await app.inject({ method: 'GET', url: '/api/calendar/events?start=2026-08-01&end=2026-07-01' });
    expect(a.statusCode).toBe(400);
    const b = await app.inject({ method: 'GET', url: '/api/calendar/events?start=2026-02-31&end=2026-03-05' });
    expect(b.statusCode).toBe(400);
  });

  it('concatenates a two-page events response', async () => {
    const fn = stubFetch([
      ['pageToken=p2', () => jsonRes({ items: [{ id: 'b', summary: 'B', start: { date: '2031-01-02' }, end: { date: '2031-01-03' } }] })],
      ['/calendars/primary/events', () => jsonRes({
        items: [{ id: 'a', summary: 'A', start: { date: '2031-01-01' }, end: { date: '2031-01-02' } }],
        nextPageToken: 'p2',
      })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/calendar/events?start=2031-01-01&end=2031-01-31' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { events: Array<{ id: string }> }).events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a wrong-state callback is 400 and does not cancel the pending flow', async () => {
    fakeTokens.tokens = null;
    const auth = await app.inject({ method: 'GET', url: '/api/calendar/auth-url' });
    const state = new URL((auth.json() as { url: string }).url).searchParams.get('state') ?? '';
    expect(state).not.toBe('');

    const bad = await app.inject({ method: 'GET', url: '/api/calendar/callback?code=c&state=wrong' });
    expect(bad.statusCode).toBe(400);
    const short = await app.inject({ method: 'GET', url: '/api/calendar/callback?code=c' });
    expect(short.statusCode).toBe(400);

    stubFetch([['oauth2.googleapis.com/token', () => jsonRes({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })]]);
    const ok = await app.inject({ method: 'GET', url: `/api/calendar/callback?code=c&state=${state}` });
    expect(ok.statusCode).toBe(200);
    expect(fakeTokens.tokens).not.toBeNull();

    // State is single-use.
    const replay = await app.inject({ method: 'GET', url: `/api/calendar/callback?code=c&state=${state}` });
    expect(replay.statusCode).toBe(400);
  });
});
