import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Watchlist of CoinGecko coin *ids* (e.g. "bitcoin", not "BTC"). */
interface CryptoState {
  watchlist: string[];
  addCoin: (id: string) => void;
  removeCoin: (id: string) => void;
}

export const useCryptoStore = create<CryptoState>()(
  persist(
    (set) => ({
      watchlist: ['bitcoin', 'ethereum', 'solana', 'dogecoin'],
      addCoin: (id) =>
        set((s) => ({
          watchlist: s.watchlist.includes(id) ? s.watchlist : [...s.watchlist, id],
        })),
      removeCoin: (id) =>
        set((s) => ({ watchlist: s.watchlist.filter((c) => c !== id) })),
    }),
    { name: 'crypto-watchlist' },
  ),
);
