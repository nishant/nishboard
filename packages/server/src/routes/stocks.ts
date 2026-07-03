import type { FastifyPluginAsync } from 'fastify';
import type { StocksData, StockQuote, StockDetail, StockBar, StockNewsItem } from '@dash/shared';
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

    const key = cacheKey(symbols);
    const cached = cache.get(key);
    if (cached) return reply.send(cached);

    const [snapshots, bars] = await Promise.all([fetchSnapshots(symbols), fetchBars(symbols)]);
    const data = buildData(symbols, snapshots, bars);
    cache.set(key, data);
    return reply.send(data);
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
