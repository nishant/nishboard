import type { TradingWatchlistData, TradingWatchlistItem } from '@dash/shared';
import { cred } from './env';
import { fetchJson, UpstreamError } from './http';

// Read-only client for nishant/trading — the single source of truth for the
// Stocks widget's tickers + badges. One call: GET /api/watchlist/summary
// (active watchlist rows + per-ticker top-pick score + open-position flag).
// Trading is tailnet-only, so "unreachable" is a normal state (laptop off the
// tailnet), not an error worth a stack. The token rides only in the
// Authorization header: never logged, never echoed into a message.

const DEFAULT_BASE_URL = 'https://trading.nish.software';
const TIMEOUT_MS = 5_000;

/** Upstream `GET /api/watchlist/summary` body (WatchlistSummaryData). */
interface SummaryBody {
  symbols?: unknown;
  scannedAt?: unknown;
}

interface SummaryRow {
  symbol?: unknown;
  topPickScore?: unknown;
  topPickStrategy?: unknown;
  hasOpenPosition?: unknown;
  openPositionCount?: unknown;
}

function isRow(v: unknown): v is SummaryRow {
  return typeof v === 'object' && v !== null;
}

/** Exported for tests. Trading's summary body → the widget's view model.
 *  Tickers upper-cased + de-duped, trading's order kept; a null/non-finite
 *  score stays null (no badge — never 0). */
export function toWatchlistData(body: SummaryBody, now = new Date()): TradingWatchlistData {
  const seen = new Set<string>();
  const items: TradingWatchlistItem[] = [];
  for (const row of Array.isArray(body.symbols) ? body.symbols : []) {
    if (!isRow(row) || typeof row.symbol !== 'string') continue;
    const ticker = row.symbol.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const score = typeof row.topPickScore === 'number' && Number.isFinite(row.topPickScore) ? row.topPickScore : null;
    const count = typeof row.openPositionCount === 'number' && row.openPositionCount > 0 ? row.openPositionCount : 0;
    items.push({
      ticker,
      topPickScore: score,
      topPickStrategy: score !== null && typeof row.topPickStrategy === 'string' ? row.topPickStrategy : null,
      openPosition: row.hasOpenPosition === true,
      openPositionCount: count,
    });
  }
  return {
    connected: true,
    items,
    scannedAt: typeof body.scannedAt === 'string' ? body.scannedAt : null,
    updatedAt: now.toISOString(),
  };
}

/** Exported for tests. Any thrown fetch failure → a disconnected state. */
export function toDisconnected(err: unknown): TradingWatchlistData {
  if (err instanceof UpstreamError) {
    if (err.status === 401) {
      return {
        connected: false,
        reason: 'unauthorized',
        message: 'Trading rejected the API token (wrong, rotated or revoked). Paste the current one from trading → Settings → API Access into Settings → Developer.',
      };
    }
    if (err.status === 404) {
      return { connected: false, reason: 'error', message: 'Trading is too old for this — it has no /api/watchlist/summary yet.' };
    }
    return { connected: false, reason: 'error', message: `Trading answered ${err.status}.` };
  }
  if (err instanceof SyntaxError) {
    // 200 with a non-JSON body — e.g. a proxy page at the configured URL.
    return { connected: false, reason: 'error', message: 'Trading sent a non-JSON response. Check TRADING_API_URL.' };
  }
  return {
    connected: false,
    reason: 'unreachable',
    message: 'Trading is unreachable. It is tailnet-only: check Tailscale and that trading is running.',
  };
}

/** Exported for tests. */
export function tradingBaseUrl(): string {
  return (cred('TRADING_API_URL').trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** Fetch trading's watchlist summary. Never throws. */
export async function fetchTradingWatchlist(): Promise<TradingWatchlistData> {
  const token = cred('TRADING_API_TOKEN').trim();
  if (!token) {
    return {
      connected: false,
      reason: 'not-configured',
      message: 'Not connected to trading. Add its read-only API token in Settings → Developer.',
    };
  }
  const base = tradingBaseUrl();
  if (!/^https?:\/\//i.test(base)) {
    return { connected: false, reason: 'error', message: 'TRADING_API_URL must start with http:// or https://.' };
  }
  try {
    const body = await fetchJson<SummaryBody | null>(
      `${base}/api/watchlist/summary`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      { timeoutMs: TIMEOUT_MS, label: 'Trading' },
    );
    return toWatchlistData(body ?? {});
  } catch (err) {
    return toDisconnected(err);
  }
}
