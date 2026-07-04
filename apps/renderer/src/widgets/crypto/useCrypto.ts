import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useCryptoStore } from '../../store/cryptoStore';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { CryptoData } from '@dash/shared';

export function useCrypto() {
  const watchlist = useCryptoStore((s) => s.watchlist);
  const interval = useGatedInterval(5 * 60 * 1000);
  return useQuery<CryptoData>({
    queryKey: ['crypto', watchlist],
    queryFn: () => apiClient.get<CryptoData>(`/api/crypto?ids=${watchlist.join(',')}`),
    refetchInterval: interval,
    staleTime: 4 * 60 * 1000,
    enabled: watchlist.length > 0,
  });
}
