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
