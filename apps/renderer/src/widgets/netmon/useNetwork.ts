import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import { useNetmonStore } from '../../store/netmonStore';
import type { NetworkMonitorData } from '@dash/shared';

const HISTORY_SIZE = 60; // 60 samples — 1min at the base 1s poll, 4min in low power

export interface NetworkHistory {
  /** Per-host latency, keyed by host. Lost samples are SKIPPED — the Loss stat
   *  carries the truth; a null would just draw a fake dip to zero. */
  latency: Record<string, number[]>;
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

  const histRef = useRef<NetworkHistory>({ latency: {}, netUp: [], netDown: [] });
  const [history, setHistory] = useState<NetworkHistory>(histRef.current);

  const interval = useGatedInterval(1000);
  const query = useQuery<NetworkMonitorData>({
    queryKey: ['network', hostsKey],
    queryFn: () => apiClient.get<NetworkMonitorData>(`/api/network?hosts=${encodeURIComponent(hostsKey)}`),
    refetchInterval: interval,
    staleTime: 900,
  });

  // Changing the host set restarts the server-side buffers too — a stale local
  // history would splice two unrelated targets into one spark.
  useEffect(() => {
    histRef.current = { latency: {}, netUp: [], netDown: [] };
    setHistory({ latency: {}, netUp: [], netDown: [] });
  }, [hostsKey]);

  useEffect(() => {
    if (!query.data) return;
    const d = query.data;
    const h = histRef.current;

    for (const host of d.hosts) {
      if (host.latestMs === null) continue; // skip lost samples (see NetworkHistory)
      const arr = (h.latency[host.host] ??= []);
      push(arr, host.latestMs);
    }
    push(h.netUp, d.totals.upMbps);
    push(h.netDown, d.totals.downMbps);

    // Copy the arrays too, not just the wrapper: the published snapshot must be
    // immutable so memoized consumers comparing by reference see each update
    // (the ref's arrays keep mutating in place). Same pattern as useHardware.
    setHistory({
      latency: Object.fromEntries(Object.entries(h.latency).map(([k, v]) => [k, [...v]])),
      netUp: [...h.netUp],
      netDown: [...h.netDown],
    });
  }, [query.data]);

  return { query, history };
}
