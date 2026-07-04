import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface StocksState {
  watchlist: string[];
  addTicker: (ticker: string) => void;
  removeTicker: (ticker: string) => void;
  setWatchlist: (tickers: string[]) => void;
}

export const useStocksStore = create<StocksState>()(
  persist(
    (set) => ({
      watchlist: ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'GOOGL', 'AMZN'],
      addTicker: (ticker) =>
        set((s) => ({
          watchlist: s.watchlist.includes(ticker) ? s.watchlist : [...s.watchlist, ticker],
        })),
      removeTicker: (ticker) =>
        set((s) => ({ watchlist: s.watchlist.filter((t) => t !== ticker) })),
      setWatchlist: (tickers) => set({ watchlist: tickers }),
    }),
    { name: 'stocks-watchlist' },
  ),
);
