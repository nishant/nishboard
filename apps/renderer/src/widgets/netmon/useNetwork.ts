import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import { useNetmonStore } from '../../store/netmonStore';
import type { NetworkMonitorData } from '@dash/shared';

const HISTORY_SIZE = 60; // 60 samples — 5 min at 5s

export interface NetworkHistory {
  netUp: number[];
  netDown: number[];
}

function push(arr: number[], val: number): void {
  arr.push(val);
  if (arr.length > HISTORY_SIZE) arr.shift();
}

export function useNetwork() {
  const hosts = useNetmonStore((s) => s.hosts);
  // join — the array's identity churns across renders; the string is stable.
  const hostsKey = hosts.join(',');

  const histRef = useRef<NetworkHistory>({ netUp: [], netDown: [] });
  const [history, setHistory] = useState<NetworkHistory>(histRef.current);

  const interval = useGatedInterval(5000);
  const query = useQuery<NetworkMonitorData>({
    queryKey: ['network', hostsKey],
    queryFn: () => apiClient.get<NetworkMonitorData>(`/api/network?hosts=${encodeURIComponent(hostsKey)}`),
    refetchInterval: interval,
    staleTime: 4500,
  });

  // Changing the host set resets the local throughput history (the per-host
  // latency spark comes straight from the server's recentMs ring).
  useEffect(() => {
    histRef.current = { netUp: [], netDown: [] };
    setHistory({ netUp: [], netDown: [] });
  }, [hostsKey]);

  useEffect(() => {
    if (!query.data) return;
    const d = query.data;
    const h = histRef.current;

    push(h.netUp, d.totals.upMbps);
    push(h.netDown, d.totals.downMbps);

    // Copy the arrays too, not just the wrapper: the published snapshot must be
    // immutable so memoized consumers comparing by reference see each update
    // (the ref's arrays keep mutating in place). Same pattern as useHardware.
    setHistory({
      netUp: [...h.netUp],
      netDown: [...h.netDown],
    });
  }, [query.data]);

  return { query, history };
}
