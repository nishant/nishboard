export interface StockQuote {
  ticker: string;
  lastPrice: number;
  change: number;
  changePercent: number;
  bid: number;
  ask: number;
  volume: number;
  dayHigh: number;
  dayLow: number;
  marketOpen: boolean;
  sparkline: number[];
}

export interface StocksData {
  equities: StockQuote[];
  updatedAt: string;
}

export interface StockBar {
  t: string; // ISO timestamp
  c: number; // close price
}

export interface StockNewsItem {
  headline: string;
  url: string;
  source: string;
  createdAt: string; // ISO timestamp
}

/** Market session state derived from Alpaca's trading calendar (holiday-aware). */
export interface MarketCalendarData {
  isOpen: boolean;
  /** ISO instant of the next regular-session open; null while the market is open. */
  nextOpen: string | null;
  /** ISO instant of today's close while open; null while closed. */
  nextClose: string | null;
  source: 'alpaca';
}

export interface StockDetail {
  ticker: string;
  bars: StockBar[];
  news: StockNewsItem[];
  /** Which bar series `bars` holds: recent 5-min intraday, or a daily-close fallback (market long closed / illiquid). */
  range: 'intraday' | 'daily';
}

// ── Trading watchlist (nishant/trading is the single source of truth) ────────

/** One watchlist ticker plus the badges trading's read-only API exposes. */
export interface TradingWatchlistItem {
  ticker: string;
  /** Composite 0..100 of trading's best candidate for this ticker in its newest
   *  finished scan; null = no candidate (render no badge, never 0). */
  topPickScore: number | null;
  /** Strategy of that candidate, e.g. "long_call"; null with the score. */
  topPickStrategy: string | null;
  /** At least one real (taken) open option position on this ticker. */
  openPosition: boolean;
  openPositionCount: number;
}

/** Why the Stocks widget can't show trading's watchlist. */
export type TradingDisconnectReason =
  /** TRADING_API_TOKEN not set in Settings → Developer. */
  | 'not-configured'
  /** Trading answered 401 — wrong, rotated or revoked token. */
  | 'unauthorized'
  /** Network error / timeout — trading is tailnet-only, so usually "not on the tailnet". */
  | 'unreachable'
  /** Trading answered, but with an unexpected status (403 caller bug, 404 trading too old) or body. */
  | 'error';

/** GET /api/stocks/watchlist — always 200; `connected` discriminates. */
export type TradingWatchlistData =
  | {
      connected: true;
      /** Trading's ACTIVE watchlist, sorted by ticker (trading's order). */
      items: TradingWatchlistItem[];
      /** When trading's newest finished scan ran (source of the scores); null = none yet. */
      scannedAt: string | null;
      updatedAt: string;
    }
  | {
      connected: false;
      reason: TradingDisconnectReason;
      message: string;
    };
