import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { StocksData } from '@dash/shared';
import { buildServer } from '../app';
import { jsonRes, stubFetch, textRes } from '../test/fetchStub';

// NOTE: module-level TTL cache keyed by the sorted symbol set — distinct
// symbol sets per test.

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ logger: false });
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ALPACA_API_KEY;
  delete process.env.ALPACA_API_SECRET;
});

function withCreds(): void {
  process.env.ALPACA_API_KEY = 'test-key';
  process.env.ALPACA_API_SECRET = 'test-secret';
}

describe('GET /api/stocks', () => {
  it('503s with a Settings pointer when Alpaca keys are missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stocks?symbols=AAPL' });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>().error).toContain('Settings → Developer');
  });

  it('maps Alpaca snapshots + bars into StocksData with auth headers from env creds', async () => {
    withCreds();
    let sawAuth = false;
    stubFetch([
      ['/stocks/snapshots', () =>
        jsonRes({
          NVDA: {
            latestTrade: { p: 101 },
            latestQuote: { bp: 100.9, ap: 101.1 },
            dailyBar: { t: '2026-07-02T20:00:00Z', o: 99, h: 103, l: 98, c: 101, v: 5_000_000 },
            prevDailyBar: { t: '2026-07-01T20:00:00Z', o: 98, h: 101, l: 97, c: 100, v: 4_000_000 },
          },
        })],
      ['/stocks/bars', () => jsonRes({ bars: { NVDA: [{ t: 'x', o: 0, h: 0, l: 0, c: 100.5, v: 1 }, { t: 'y', o: 0, h: 0, l: 0, c: 101, v: 1 }] } })],
    ]);
    // Wrap the stub to also capture the auth header.
    const inner = globalThis.fetch;
    vi.stubGlobal('fetch', (async (input: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.['APCA-API-KEY-ID'] === 'test-key') sawAuth = true;
      return inner(input, init);
    }) as typeof fetch);

    const res = await app.inject({ method: 'GET', url: '/api/stocks?symbols=nvda' });
    expect(res.statusCode).toBe(200);
    const data = res.json<StocksData>();
    expect(data.equities).toHaveLength(1);
    const q = data.equities[0];
    expect(q.ticker).toBe('NVDA'); // uppercased
    // latestTrade.p and dailyBar.c agree (101) so lastPrice is deterministic
    // whether or not the market is open while the test runs.
    expect(q.lastPrice).toBe(101);
    expect(q.change).toBe(1); // vs prevDailyBar.c = 100
    expect(q.changePercent).toBeCloseTo(1);
    expect(q.bid).toBe(100.9);
    expect(q.ask).toBe(101.1);
    expect(q.volume).toBe(5_000_000);
    expect(q.sparkline).toEqual([100.5, 101]);
    expect(typeof q.marketOpen).toBe('boolean');
    expect(sawAuth).toBe(true);
  });

  it('passes an Alpaca 403 through (bad key is actionable)', async () => {
    withCreds();
    stubFetch([
      ['/stocks/snapshots', () => textRes('forbidden', 403)],
      ['/stocks/bars', () => jsonRes({ bars: {} })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/stocks?symbols=TSLA' });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/stocks/detail', () => {
  it('rejects malformed symbols', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/stocks/detail?symbol=NOT_VALID!' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/stocks/detail' })).statusCode).toBe(400);
  });

  it('falls back to daily bars when intraday is empty, and survives a dead news API', async () => {
    withCreds();
    stubFetch([
      // 5Min query first (intraday, empty) then 1Day (has bars) — both hit /stocks/bars.
      ['timeframe=5Min', () => jsonRes({ bars: { AMD: [] } })],
      ['timeframe=1Day', () => jsonRes({ bars: { AMD: [{ t: '2026-07-01', o: 0, h: 0, l: 0, c: 140, v: 1 }] } })],
      ['/v1beta1/news', () => textRes('down', 500)],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/stocks/detail?symbol=amd' });
    expect(res.statusCode).toBe(200);
    const data = res.json<{ ticker: string; range: string; bars: unknown[]; news: unknown[] }>();
    expect(data.ticker).toBe('AMD');
    expect(data.range).toBe('daily');
    expect(data.bars).toHaveLength(1);
    expect(data.news).toEqual([]); // fail-soft
  });
});
