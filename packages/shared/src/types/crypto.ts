export interface CryptoCoinData {
  /** CoinGecko coin id, e.g. "bitcoin". */
  id: string;
  /** Ticker symbol, e.g. "btc". */
  symbol: string;
  name: string;
  /** Coin icon URL (CoinGecko CDN). */
  image: string;
  priceUsd: number;
  change24hPercent: number;
  marketCapUsd: number;
  /** Downsampled 7-day price line (USD). */
  sparkline7d: number[];
}

export interface CryptoData {
  coins: CryptoCoinData[];
  updatedAt: string;
}
