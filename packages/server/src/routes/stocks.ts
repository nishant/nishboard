import type { FastifyPluginAsync } from 'fastify';
import type { StocksData, StockQuote, StockDetail, StockBar, StockNewsItem, MarketCalendarData } from '@dash/shared';
import { fetchJson, HttpError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN'];

function baseUrl(): string {
  return process.env['ALPACA_BASE_URL'] ?? 'https://data.alpaca.markets/v2';
}

function authHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': cred('ALPACA_API_KEY'),
    'APCA-API-SECRET-KEY': cred('ALPACA_API_SECRET'),
  };
}

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface AlpacaQuote {
  bp: number;
  ap: number;
}

interface AlpacaTrade {
  p: number;
}

interface AlpacaSnapshot {
  latestTrade?: AlpacaTrade;
  latestQuote?: AlpacaQuote;
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}

function isMarketOpen(): boolean {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const day = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const min = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  if (day === 'Sat' || day === 'Sun') return false;
  const total = hour * 60 + min;
  return total >= 9 * 60 + 30 && total < 16 * 60;
}

async function fetchSnapshots(symbols: string[]): Promise<Map<string, AlpacaSnapshot>> {
  const url = `${baseUrl()}/stocks/snapshots?symbols=${symbols.join(',')}&feed=iex`;
  const data = await fetchJson<Record<string, AlpacaSnapshot>>(
    url,
    { headers: authHeaders() },
    { label: 'Alpaca snapshots' },
  );
  return new Map(Object.entries(data));
}

async function fetchBars(symbols: string[]): Promise<Map<string, number[]>> {
  const url = `${baseUrl()}/stocks/bars?symbols=${symbols.join(',')}&timeframe=5Min&limit=60&feed=iex`;
  try {
    const data = await fetchJson<{ bars: Record<string, AlpacaBar[]> }>(
      url,
      { headers: authHeaders() },
      { label: 'Alpaca bars' },
    );
    const result = new Map<string, number[]>();
    for (const [sym, bars] of Object.entries(data.bars ?? {})) {
      result.set(sym, bars.map((b) => b.c));
    }
    return result;
  } catch {
    // bars are non-critical; return empty map rather than failing
    return new Map();
  }
}

function buildData(
  symbols: string[],
  snapshots: Map<string, AlpacaSnapshot>,
  bars: Map<string, number[]>,
): StocksData {
  const open = isMarketOpen();
  const equities: StockQuote[] = symbols.map((ticker) => {
    const snap = snapshots.get(ticker);
    const lastPrice = open
      ? (snap?.latestTrade?.p ?? snap?.dailyBar?.c ?? 0)
      : (snap?.dailyBar?.c ?? snap?.latestTrade?.p ?? 0);
    const prevClose = snap?.prevDailyBar?.c ?? lastPrice;
    const change = prevClose > 0 ? lastPrice - prevClose : 0;
    const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;
    return {
      ticker,
      lastPrice,
      change,
      changePercent,
      bid: snap?.latestQuote?.bp ?? 0,
      ask: snap?.latestQuote?.ap ?? 0,
      volume: snap?.dailyBar?.v ?? 0,
      dayHigh: snap?.dailyBar?.h ?? 0,
      dayLow: snap?.dailyBar?.l ?? 0,
      marketOpen: open,
      sparkline: bars.get(ticker) ?? [],
    };
  });
  return { equities, updatedAt: new Date().toISOString() };
}

const CACHE_TTL = 4 * 60 * 1000; // 4 min — slightly under renderer's 5-min poll
const cache = new TtlCache<string, StocksData>(CACHE_TTL);

function cacheKey(symbols: string[]): string {
  return [...symbols].sort().join(',');
}

// ── Per-symbol detail: intraday bars + recent news (same Alpaca keys) ──────────

interface AlpacaNewsItem { headline: string; url: string; source: string; created_at: string; }

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchBarSeries(
  symbol: string,
  timeframe: string,
  start: string,
  limit: number,
  sort: 'asc' | 'desc',
): Promise<StockBar[]> {
  const url =
    `${baseUrl()}/stocks/bars?symbols=${symbol}&timeframe=${timeframe}` +
    `&start=${encodeURIComponent(start)}&limit=${limit}&sort=${sort}&feed=iex`;
  try {
    const data = await fetchJson<{ bars?: Record<string, AlpacaBar[]> }>(
      url,
      { headers: authHeaders() },
      { label: 'Alpaca bars' },
    );
    return (data.bars?.[symbol] ?? []).map((b) => ({ t: b.t, c: b.c }));
  } catch {
    return [];
  }
}

/**
 * Detail chart bars. Alpaca returns bars ascending *from* `start`, so we pull the most
 * recent ones with `sort=desc` then reverse to chronological order.
 * - Intraday: last ~100 5-min bars within a 5-day window (spans the most recent session,
 *   even across a weekend). Empty once the market's been closed long enough / illiquid symbol →
 * - Daily fallback: ~2 months of daily closes so a closed market still shows a line.
 */
async function fetchDetailBars(
  symbol: string,
): Promise<{ bars: StockBar[]; range: 'intraday' | 'daily' }> {
  const intraday = await fetchBarSeries(symbol, '5Min', daysAgoIso(5), 100, 'desc');
  if (intraday.length > 0) return { bars: intraday.reverse(), range: 'intraday' };
  const daily = await fetchBarSeries(symbol, '1Day', daysAgoIso(60), 60, 'asc');
  return { bars: daily, range: 'daily' };
}

async function fetchSymbolNews(symbol: string): Promise<StockNewsItem[]> {
  // Alpaca News API (Benzinga) — v1beta1, same auth headers.
  const url = `https://data.alpaca.markets/v1beta1/news?symbols=${symbol}&limit=10&sort=desc`;
  try {
    const data = await fetchJson<{ news?: AlpacaNewsItem[] }>(
      url,
      { headers: authHeaders() },
      { label: 'Alpaca news' },
    );
    return (data.news ?? []).map((n) => ({
      headline: n.headline,
      url: n.url,
      source: n.source,
      createdAt: n.created_at,
    }));
  } catch {
    return [];
  }
}

const DETAIL_TTL = 2 * 60 * 1000;
const detailCache = new TtlCache<string, StockDetail>(DETAIL_TTL);

// ── Market calendar (Alpaca /v2/calendar — TRADING host, not the data host) ──
// Paper-only keys 401/403 against the live host, so try live first and fall
// back to paper once, remembering whichever worked for the process lifetime.

interface AlpacaCalendarDay { date: string; open: string; close: string; }

const TRADING_HOSTS = ['https://api.alpaca.markets', 'https://paper-api.alpaca.markets'];
let tradingHost: string | null = null;

const CALENDAR_TTL = 12 * 60 * 60 * 1000; // trading days change ~never intra-day
const calendarCache = new TtlCache<string, AlpacaCalendarDay[]>(CALENDAR_TTL);

async function fetchCalendarDays(): Promise<AlpacaCalendarDay[]> {
  const cached = calendarCache.get('days');
  if (cached) return cached;
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const path = `/v2/calendar?start=${start}&end=${end}`;
  const hosts = tradingHost ? [tradingHost] : TRADING_HOSTS;
  let lastErr: unknown;
  for (const host of hosts) {
    try {
      const days = await fetchJson<AlpacaCalendarDay[]>(
        `${host}${path}`,
        { headers: authHeaders() },
        { label: 'Alpaca calendar' },
      );
      tradingHost = host;
      calendarCache.set('days', days);
      return days;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** UTC offset suffix (e.g. "-04:00") for New York on the given date — DST-safe
 *  without a timezone lib. */
function etOffset(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-05:00';
  return name.replace('GMT', '') || '-05:00';
}

function buildCalendar(days: AlpacaCalendarDay[]): MarketCalendarData {
  const now = Date.now();
  for (const d of days) {
    const offset = etOffset(d.date);
    const open = new Date(`${d.date}T${d.open}:00${offset}`).getTime();
    const close = new Date(`${d.date}T${d.close}:00${offset}`).getTime();
    if (now < open) return { isOpen: false, nextOpen: new Date(open).toISOString(), nextClose: null, source: 'alpaca' };
    if (now < close) return { isOpen: true, nextOpen: null, nextClose: new Date(close).toISOString(), source: 'alpaca' };
  }
  // 10-day window exhausted (shouldn't happen) — unknown but well-typed.
  return { isOpen: false, nextOpen: null, nextClose: null, source: 'alpaca' };
}

export const stocksRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Querystring: { symbols?: string };
    Reply: StocksData | { error: string };
  }>('/', async (req, reply) => {
    const raw = req.query.symbols ?? DEFAULT_SYMBOLS.join(',');
    const symbols = raw
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 50);

    if (symbols.length === 0) throw new HttpError(400, 'No symbols provided');
    if (!cred('ALPACA_API_KEY') || !cred('ALPACA_API_SECRET')) {
      // First-run pointer: without this the widget surfaces a raw Alpaca 403.
      throw new HttpError(503, 'Alpaca keys not configured — add them in Settings → Developer');
    }

    const key = cacheKey(symbols);
    const cached = cache.get(key);
    if (cached) return reply.send(cached);

    const [snapshots, bars] = await Promise.all([fetchSnapshots(symbols), fetchBars(symbols)]);
    const data = buildData(symbols, snapshots, bars);
    cache.set(key, data);
    return reply.send(data);
  });

  fastify.get<{ Reply: MarketCalendarData | { error: string } }>('/calendar', async (_req, reply) => {
    if (!cred('ALPACA_API_KEY') || !cred('ALPACA_API_SECRET')) {
      throw new HttpError(503, 'Alpaca keys not configured — add them in Settings → Developer');
    }
    const days = await fetchCalendarDays();
    // Computed per request from the 12h-cached day list — the countdown target
    // (nextOpen/nextClose) flips as time passes even between cache refreshes.
    return reply.send(buildCalendar(days));
  });

  fastify.get<{ Querystring: { symbol?: string }; Reply: StockDetail | { error: string } }>(
    '/detail',
    async (req, reply) => {
      const symbol = (req.query.symbol ?? '').trim().toUpperCase();
      if (!/^[A-Z.]{1,10}$/.test(symbol)) throw new HttpError(400, 'Invalid symbol');

      const cached = detailCache.get(symbol);
      if (cached) return reply.send(cached);

      const [detail, news] = await Promise.all([fetchDetailBars(symbol), fetchSymbolNews(symbol)]);
      const data: StockDetail = { ticker: symbol, bars: detail.bars, news, range: detail.range };
      detailCache.set(symbol, data);
      return reply.send(data);
    },
  );
};
