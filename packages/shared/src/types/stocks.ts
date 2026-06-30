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

export interface StockDetail {
  ticker: string;
  bars: StockBar[];
  news: StockNewsItem[];
}
