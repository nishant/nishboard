import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useCryptoStore } from '../../store/cryptoStore';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { CryptoData } from '@dash/shared';

/** `enabled=false` observers (e.g. the alerts evaluator with no crypto rules)
 *  read cache but never fetch or schedule refetches. */
export function useCrypto(enabled = true, interval?: number | false) {
  const watchlist = useCryptoStore((s) => s.watchlist);
  const gated = useGatedInterval(5 * 60 * 1000);
  return useQuery<CryptoData>({
    queryKey: ['crypto', watchlist],
    queryFn: () => apiClient.get<CryptoData>(`/api/crypto?ids=${watchlist.join(',')}`),
    refetchInterval: interval ?? gated,
    staleTime: 4 * 60 * 1000,
    enabled: enabled && watchlist.length > 0,
  });
}
