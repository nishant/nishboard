import type { FastifyPluginAsync } from 'fastify';
import type { StocksData, StockQuote, StockDetail, StockBar, StockNewsItem } from '@dash/shared';

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN'];

function baseUrl(): string {
  return process.env['ALPACA_BASE_URL'] ?? 'https://data.alpaca.markets/v2';
}

function authHeaders(): Record<string, string> {
  return {
    'APCA-API-KEY-ID': process.env['ALPACA_API_KEY'] || process.env['ALPACA_API_KEY_BUILTIN'] || '',
    'APCA-API-SECRET-KEY': process.env['ALPACA_API_SECRET'] || process.env['ALPACA_API_SECRET_BUILTIN'] || '',
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
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alpaca snapshots ${res.status}: ${body}`);
  }
  const data = (await res.json()) as Record<string, AlpacaSnapshot>;
  return new Map(Object.entries(data));
}

async function fetchBars(symbols: string[]): Promise<Map<string, number[]>> {
  const url = `${baseUrl()}/stocks/bars?symbols=${symbols.join(',')}&timeframe=5Min&limit=60&feed=iex`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    // bars are non-critical; return empty map rather than failing
    return new Map();
  }
  const data = (await res.json()) as { bars: Record<string, AlpacaBar[]> };
  const result = new Map<string, number[]>();
  for (const [sym, bars] of Object.entries(data.bars ?? {})) {
    result.set(sym, bars.map((b) => b.c));
  }
  return result;
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

const cache = new Map<string, { data: StocksData; expiresAt: number }>();
const CACHE_TTL = 4 * 60 * 1000; // 4 min — slightly under renderer's 5-min poll

function cacheKey(symbols: string[]): string {
  return [...symbols].sort().join(',');
}

// ── Per-symbol detail: intraday bars + recent news (same Alpaca keys) ──────────

interface AlpacaNewsItem { headline: string; url: string; source: string; created_at: string; }

async function fetchIntradayBars(symbol: string): Promise<StockBar[]> {
  const url = `${baseUrl()}/stocks/bars?symbols=${symbol}&timeframe=5Min&limit=100&feed=iex`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return [];
  const data = (await res.json()) as { bars?: Record<string, AlpacaBar[]> };
  return (data.bars?.[symbol] ?? []).map((b) => ({ t: b.t, c: b.c }));
}

async function fetchSymbolNews(symbol: string): Promise<StockNewsItem[]> {
  // Alpaca News API (Benzinga) — v1beta1, same auth headers.
  const url = `https://data.alpaca.markets/v1beta1/news?symbols=${symbol}&limit=10&sort=desc`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return [];
  const data = (await res.json()) as { news?: AlpacaNewsItem[] };
  return (data.news ?? []).map((n) => ({
    headline: n.headline,
    url: n.url,
    source: n.source,
    createdAt: n.created_at,
  }));
}

const detailCache = new Map<string, { data: StockDetail; at: number }>();
const DETAIL_TTL = 2 * 60 * 1000;

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

    if (symbols.length === 0) return reply.code(400).send({ error: 'No symbols provided' });

    const key = cacheKey(symbols);
    const cached = cache.get(key);
    if (cached && Date.now() < cached.expiresAt) return reply.send(cached.data);

    try {
      const [snapshots, bars] = await Promise.all([fetchSnapshots(symbols), fetchBars(symbols)]);
      const data = buildData(symbols, snapshots, bars);
      cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL });
      return reply.send(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fastify.log.error(`[stocks] ${msg}`);
      return reply.code(502).send({ error: msg });
    }
  });

  fastify.get<{ Querystring: { symbol?: string }; Reply: StockDetail | { error: string } }>(
    '/detail',
    async (req, reply) => {
      const symbol = (req.query.symbol ?? '').trim().toUpperCase();
      if (!/^[A-Z.]{1,10}$/.test(symbol)) return reply.code(400).send({ error: 'Invalid symbol' });

      const cached = detailCache.get(symbol);
      if (cached && Date.now() - cached.at < DETAIL_TTL) return reply.send(cached.data);

      try {
        const [bars, news] = await Promise.all([fetchIntradayBars(symbol), fetchSymbolNews(symbol)]);
        const data: StockDetail = { ticker: symbol, bars, news };
        detailCache.set(symbol, { data, at: Date.now() });
        return reply.send(data);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Detail lookup failed' });
      }
    },
  );
};
