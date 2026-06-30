import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useStocksStore } from '../../store/stocksStore';
import type { StocksData, StockDetail } from '@dash/shared';

export function useStocks() {
  const watchlist = useStocksStore((s) => s.watchlist);
  return useQuery<StocksData>({
    queryKey: ['stocks', watchlist],
    queryFn: () => apiClient.get<StocksData>(`/api/stocks?symbols=${watchlist.join(',')}`),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    enabled: watchlist.length > 0,
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
