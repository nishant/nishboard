import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useStocksStore } from '../../store/stocksStore';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { StocksData, StockDetail, MarketCalendarData } from '@dash/shared';

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

/** `enabled=false` observers (e.g. the alerts evaluator with no stock rules)
 *  read cache but never fetch or schedule refetches. */
export function useStocks(enabled = true, interval?: number | false) {
  const watchlist = useStocksStore((s) => s.watchlist);
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
