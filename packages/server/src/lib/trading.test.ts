import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from './http';
import { fetchTradingWatchlist, toDisconnected, toWatchlistData, tradingBaseUrl } from './trading';
import { jsonRes, stubFetch, textRes } from '../test/fetchStub';

const NOW = new Date('2026-10-30T15:00:00Z');

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TRADING_API_URL;
  delete process.env.TRADING_API_TOKEN;
});

describe('toWatchlistData', () => {
  it('maps trading summary rows, keeps order, upper-cases and de-dupes', () => {
    const data = toWatchlistData(
      {
        symbols: [
          { symbol: 'aapl', topPickScore: 74.9, topPickStrategy: 'long_call', hasOpenPosition: true, openPositionCount: 1 },
          { symbol: 'MSFT', topPickScore: null, topPickStrategy: null, hasOpenPosition: false, openPositionCount: 0 },
          { symbol: 'AAPL', topPickScore: 10, hasOpenPosition: false },
          { symbol: 42 },
          null,
        ],
        scannedAt: '2026-10-30T13:45:12.000Z',
      },
      NOW,
    );
    expect(data).toEqual({
      connected: true,
      items: [
        { ticker: 'AAPL', topPickScore: 74.9, topPickStrategy: 'long_call', openPosition: true, openPositionCount: 1 },
        { ticker: 'MSFT', topPickScore: null, topPickStrategy: null, openPosition: false, openPositionCount: 0 },
      ],
      scannedAt: '2026-10-30T13:45:12.000Z',
      updatedAt: NOW.toISOString(),
    });
  });

  it('keeps a missing/non-finite score null (never 0) and tolerates an empty body', () => {
    const data = toWatchlistData({ symbols: [{ symbol: 'SPY', topPickScore: Number.NaN, topPickStrategy: 'x' }] }, NOW);
    expect(data).toMatchObject({
      connected: true,
      scannedAt: null,
      items: [{ ticker: 'SPY', topPickScore: null, topPickStrategy: null, openPosition: false, openPositionCount: 0 }],
    });
    expect(toWatchlistData({}, NOW)).toMatchObject({ connected: true, items: [], scannedAt: null });
  });
});

describe('toDisconnected', () => {
  it('maps 401 to unauthorized; 403/404/5xx to error; JSON junk to error; network to unreachable', () => {
    expect(toDisconnected(new UpstreamError(401, 'x'))).toMatchObject({ reason: 'unauthorized' });
    expect(toDisconnected(new UpstreamError(403, 'x'))).toMatchObject({ reason: 'error', message: 'Trading answered 403.' });
    expect(toDisconnected(new UpstreamError(404, 'x'))).toMatchObject({ reason: 'error', message: expect.stringContaining('too old') });
    expect(toDisconnected(new SyntaxError('bad json'))).toMatchObject({ reason: 'error' });
    expect(toDisconnected(new TypeError('fetch failed'))).toMatchObject({ reason: 'unreachable' });
  });
});

describe('tradingBaseUrl', () => {
  it('defaults to the tailnet host and trims trailing slashes', () => {
    expect(tradingBaseUrl()).toBe('https://trading.nish.software');
    process.env.TRADING_API_URL = 'http://127.0.0.1:7433//';
    expect(tradingBaseUrl()).toBe('http://127.0.0.1:7433');
  });
});

describe('fetchTradingWatchlist', () => {
  it('is not-configured without a token, and never fetches', async () => {
    const fn = stubFetch([]);
    expect(await fetchTradingWatchlist()).toMatchObject({ connected: false, reason: 'not-configured' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects a non-http URL without fetching', async () => {
    const fn = stubFetch([]);
    process.env.TRADING_API_URL = 'trading.nish.software';
    process.env.TRADING_API_TOKEN = 'otar_test';
    expect(await fetchTradingWatchlist()).toMatchObject({ connected: false, reason: 'error' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('GETs the summary route with the bearer token, default base URL', async () => {
    process.env.TRADING_API_TOKEN = 'otar_test';
    const fn = stubFetch([
      ['/api/watchlist/summary', () => jsonRes({ symbols: [{ symbol: 'AMD', topPickScore: 71, hasOpenPosition: true, openPositionCount: 2 }], scanRunId: 1, scannedAt: null, updatedAt: '' })],
    ]);
    expect(await fetchTradingWatchlist()).toMatchObject({
      connected: true,
      items: [{ ticker: 'AMD', topPickScore: 71, openPosition: true, openPositionCount: 2 }],
    });
    const [[url, init]] = fn.mock.calls as [string, RequestInit][];
    expect(url).toBe('https://trading.nish.software/api/watchlist/summary');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer otar_test');
  });

  it('maps a rotated token to unauthorized without leaking it', async () => {
    process.env.TRADING_API_TOKEN = 'otar_secret';
    stubFetch([['/api/watchlist/summary', () => textRes('{"error":"Not authenticated"}', 401)]]);
    const data = await fetchTradingWatchlist();
    expect(data).toMatchObject({ connected: false, reason: 'unauthorized' });
    expect(JSON.stringify(data)).not.toContain('otar_secret');
  });

  it('maps a network failure to unreachable', async () => {
    process.env.TRADING_API_TOKEN = 'otar_test';
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));
    expect(await fetchTradingWatchlist()).toMatchObject({ connected: false, reason: 'unreachable' });
  });
});
