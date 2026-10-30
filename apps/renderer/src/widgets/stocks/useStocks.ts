import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { StocksData, StockDetail, MarketCalendarData, TradingWatchlistData } from '@dash/shared';

/** Alpaca trading calendar (holiday-aware open/close). The countdown badge
 *  ticks client-side; a 30-min poll just keeps nextOpen/nextClose fresh.
 *  Fails quietly (retry: 1, no error UI) — the widget falls back to the
 *  Intl-based session heuristic when this has no data. */
export function useMarketCalendar() {
  const interval = useGatedInterval(30 * 60 * 1000);
  return useQuery<MarketCalendarData>({
    queryKey: ['stocks-calendar'],
    queryFn: () => apiClient.get<MarketCalendarData>('/api/stocks/calendar'),
    refetchInterval: interval,
    staleTime: 15 * 60 * 1000,
    retry: 1,
  });
}

/** Trading's watchlist (tickers + top-pick / open-position badges) via the
 *  Fastify proxy — trading is the single source of truth, nishboard never
 *  edits it. Always resolves (a disconnected state is data, not an error). */
export function useTradingWatchlist(enabled = true) {
  const gated = useGatedInterval(5 * 60 * 1000);
  return useQuery<TradingWatchlistData>({
    queryKey: ['stocks', 'watchlist'],
    queryFn: () => apiClient.get<TradingWatchlistData>('/api/stocks/watchlist'),
    refetchInterval: gated,
    staleTime: 60_000,
    enabled,
  });
}

/** Watchlist tickers in trading's order; [] while loading or disconnected. */
export function useWatchlistTickers(enabled = true): string[] {
  const { data } = useTradingWatchlist(enabled);
  return data?.connected ? data.items.map((i) => i.ticker) : [];
}

/** `enabled=false` observers (e.g. the alerts evaluator with no stock rules)
 *  read cache but never fetch or schedule refetches. */
export function useStocks(enabled = true, interval?: number | false) {
  const watchlist = useWatchlistTickers(enabled);
  const gated = useGatedInterval(5 * 60 * 1000);
  return useQuery<StocksData>({
    queryKey: ['stocks', watchlist],
    queryFn: () => apiClient.get<StocksData>(`/api/stocks?symbols=${watchlist.join(',')}`),
    refetchInterval: interval ?? gated,
    staleTime: 4 * 60 * 1000,
    enabled: enabled && watchlist.length > 0,
  });
}

export function useStockDetail(symbol: string | null) {
  return useQuery<StockDetail>({
    queryKey: ['stock-detail', symbol],
    queryFn: () => apiClient.get<StockDetail>(`/api/stocks/detail?symbol=${symbol}`),
    enabled: !!symbol,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
