import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../lib/alerts';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import { useInboxUiStore } from '../../store/inboxUiStore';
import type {
  InboxFeedData,
  InboxHandleAllRequestBody,
  InboxItemData,
  InboxListData,
  InboxSnoozeRequestBody,
} from '@dash/shared';

export function useInboxFeed() {
  const view = useInboxUiStore((s) => s.view);
  const source = useInboxUiStore((s) => s.source);
  const interval = useGatedInterval(60_000);

  const query = useInfiniteQuery({
    queryKey: ['inbox', view, source],
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({
        view,
        ...(source ? { source } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      });
      return apiClient.get<InboxFeedData>(`/api/inbox/items?${qs.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last): string | undefined =>
      last.state === 'ok' ? (last.list.nextCursor ?? undefined) : undefined,
    refetchInterval: interval,
    staleTime: 30_000,
  });

  const pages = query.data?.pages;
  const derived = useMemo(() => {
    if (!pages || pages.length === 0) return { state: undefined, items: [] as InboxItemData[], first: null };
    const first = pages[0];
    const seen = new Set<number>();
    const items: InboxItemData[] = [];
    for (const p of pages) {
      if (p.state !== 'ok') continue;
      for (const it of p.list.items) {
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        items.push(it);
      }
    }
    const firstList: InboxListData | null = first.state === 'ok' ? first.list : null;
    return { state: first.state, items, first: firstList };
  }, [pages]);

  return {
    ...query,
    state: derived.state,
    items: derived.items,
    counts: derived.first?.counts ?? null,
    sources: derived.first?.sources ?? [],
  };
}

export function useInboxMutations() {
  const queryClient = useQueryClient();
  const common = {
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['inbox'] }),
    onError: (err: Error) => toast('Inbox', err.message, 'error'),
  };

  const handle = useMutation({
    mutationFn: (id: number) => apiClient.post<InboxItemData>(`/api/inbox/items/${id}/handle`, {}),
    ...common,
  });
  const unhandle = useMutation({
    mutationFn: (id: number) => apiClient.post<InboxItemData>(`/api/inbox/items/${id}/unhandle`, {}),
    ...common,
  });
  const snooze = useMutation({
    mutationFn: ({ id, until }: { id: number; until: Date }) => {
      const body: InboxSnoozeRequestBody = { until: until.toISOString() };
      return apiClient.post<InboxItemData>(`/api/inbox/items/${id}/snooze`, body);
    },
    ...common,
  });
  const unsnooze = useMutation({
    mutationFn: (id: number) => apiClient.post<InboxItemData>(`/api/inbox/items/${id}/unsnooze`, {}),
    ...common,
  });
  const handleAll = useMutation({
    mutationFn: (source?: string) => {
      const body: InboxHandleAllRequestBody = source ? { source } : {};
      return apiClient.post<{ count: number }>('/api/inbox/items/handle-all', body);
    },
    ...common,
  });

  return { handle, unhandle, snooze, unsnooze, handleAll };
}
