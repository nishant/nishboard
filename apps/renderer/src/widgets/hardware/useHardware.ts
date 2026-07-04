import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import type { HardwareData } from '@dash/shared';

const HISTORY_SIZE = 60; // 60 seconds at 1s poll

export interface HardwareHistory {
  cpuUsage: number[];
  gpuUsage: number[];
  ramUsage: number[];
  netUp: number[];
  netDown: number[];
  diskRead: number[];
  diskWrite: number[];
}

function push(arr: number[], val: number): void {
  arr.push(val);
  if (arr.length > HISTORY_SIZE) arr.shift();
}

export function useHardware() {
  const histRef = useRef<HardwareHistory>({
    cpuUsage: [],
    gpuUsage: [],
    ramUsage: [],
    netUp: [],
    netDown: [],
    diskRead: [],
    diskWrite: [],
  });
  const [history, setHistory] = useState<HardwareHistory>(histRef.current);

  const query = useQuery<HardwareData>({
    queryKey: ['hardware'],
    queryFn: () => apiClient.get<HardwareData>('/api/hardware'),
    refetchInterval: 1000,
    staleTime: 900,
    // system_profiler (graphics) can take 3-5s on cold start — retry generously
    retry: 8,
    retryDelay: 1000,
  });

  useEffect(() => {
    if (!query.data) return;
    const d = query.data;
    const h = histRef.current;

    push(h.cpuUsage, d.cpu.usagePercent);
    push(h.gpuUsage, d.gpu?.usagePercent ?? 0);
    push(h.ramUsage, d.ram.usagePercent);
    push(h.netUp, d.network.reduce((s, n) => s + n.uploadMbps, 0));
    push(h.netDown, d.network.reduce((s, n) => s + n.downloadMbps, 0));
    push(h.diskRead, d.disks.reduce((s, dk) => s + dk.readMBs, 0));
    push(h.diskWrite, d.disks.reduce((s, dk) => s + dk.writeMBs, 0));

    // Copy the arrays too, not just the wrapper: the published snapshot must be
    // immutable so memoized consumers comparing by reference see each update
    // (the ref's arrays keep mutating in place).
    setHistory({
      cpuUsage: [...h.cpuUsage],
      gpuUsage: [...h.gpuUsage],
      ramUsage: [...h.ramUsage],
      netUp: [...h.netUp],
      netDown: [...h.netDown],
      diskRead: [...h.diskRead],
      diskWrite: [...h.diskWrite],
    });
  }, [query.data]);

  return { query, history };
}
