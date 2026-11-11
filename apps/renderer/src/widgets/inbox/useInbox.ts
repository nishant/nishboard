import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
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

/** Exported for tests. */
export function nextPageParam(last: InboxFeedData): string | undefined {
  return last.state === 'ok' ? (last.list.nextCursor ?? undefined) : undefined;
}

/** Exported for tests. Dedupes by id (first copy wins), skips non-ok pages; state/list come from the first page. */
export function mergeInboxPages(pages: InboxFeedData[] | undefined): {
  state: InboxFeedData['state'] | undefined;
  items: InboxItemData[];
  first: InboxListData | null;
} {
  if (!pages || pages.length === 0) return { state: undefined, items: [], first: null };
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
  return { state: first.state, items, first: first.state === 'ok' ? first.list : null };
}

/** Exported for tests. Swaps in a freshly fetched head page; later pages and all page params are kept. */
export function replaceHeadPage(
  data: InfiniteData<InboxFeedData, string | null> | undefined,
  head: InboxFeedData,
): InfiniteData<InboxFeedData, string | null> | undefined {
  if (!data || data.pages.length === 0) return data;
  return { ...data, pages: [head, ...data.pages.slice(1)] };
}

function fetchInboxPage(view: string, source: string | null, cursor: string | null): Promise<InboxFeedData> {
  const qs = new URLSearchParams({
    view,
    ...(source ? { source } : {}),
    ...(cursor ? { cursor } : {}),
  });
  return apiClient.get<InboxFeedData>(`/api/inbox/items?${qs.toString()}`);
}

export function useInboxFeed() {
  const queryClient = useQueryClient();
  const view = useInboxUiStore((s) => s.view);
  const source = useInboxUiStore((s) => s.source);
  const interval = useGatedInterval(60_000);

  const query = useInfiniteQuery({
    queryKey: ['inbox', view, source],
    queryFn: ({ pageParam }) => fetchInboxPage(view, source, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: nextPageParam,
    // No built-in polling: it would re-request every loaded page. The effect
    // below refreshes only the head page (the newest items) and keeps the rest.
    refetchInterval: false,
    staleTime: 30_000,
  });

  const hasData = query.data !== undefined;
  useEffect(() => {
    if (interval === false || !hasData) return;
    const key = ['inbox', view, source];
    const id = setInterval(() => {
      void fetchInboxPage(view, source, null)
        .then((head) => {
          queryClient.setQueryData<InfiniteData<InboxFeedData, string | null>>(key, (old) => replaceHeadPage(old, head));
        })
        .catch(() => {
          /* keep showing the last data; the next tick or a manual refetch retries */
        });
    }, interval);
    return () => clearInterval(id);
  }, [interval, hasData, view, source, queryClient]);

  const pages = query.data?.pages;
  const derived = useMemo(() => mergeInboxPages(pages), [pages]);

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

  // Producer-defined action: 200 + the updated item even when the target failed.
  const runAction = useMutation({
    mutationFn: ({ id, actionId }: { id: number; actionId: string }) =>
      apiClient.post<InboxItemData>(`/api/inbox/items/${id}/actions/${encodeURIComponent(actionId)}`, {}),
    onSuccess: (item: InboxItemData) => {
      if (item.lastAction && !item.lastAction.ok) toast('Inbox', item.lastAction.error ?? 'The action failed.', 'error');
    },
    ...common,
  });

  return { handle, unhandle, snooze, unsnooze, handleAll, runAction };
}
