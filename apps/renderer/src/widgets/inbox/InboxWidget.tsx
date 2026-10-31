import { useEffect, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { ExternalLink, Inbox as InboxIcon, KeyRound } from 'lucide-react';
import { Button, EmptyState, INBOX_SOURCE_LABELS, Inbox, toast } from '@nish/ui';
import type { InboxAction, InboxItem } from '@nish/ui';
import { useInboxFeed, useInboxMutations } from './useInbox';
import { groupBySeverity, safeHref } from './inboxSort';
import { isAckedIn, useInboxUiStore } from '../../store/inboxUiStore';
import { useOverlayStore } from '../../store/overlayStore';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';

const ACK = '__ack';
const UNACK = '__unack';
const NO_COUNTS = { open: 0, snoozed: 0, handled: 0 } as const;

export function InboxActions() {
  return (
    <>
      <RefreshAction queryKey={['inbox']} title="Refresh inbox" />
      <HeaderAction
        title="Open Inbox page"
        onClick={() => window.electron?.openExternal?.('https://start.nish.software/#/inbox')}
      >
        <ExternalLink size={11} />
      </HeaderAction>
    </>
  );
}

/** Electron denies target=_blank windows, so http(s) links go to the system browser. */
function openLinksExternally(e: MouseEvent<HTMLDivElement>): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const href = safeHref(anchor.href);
  if (!href) return;
  e.preventDefault();
  window.electron?.openExternal?.(href);
}

function settingsState(title: string, detail: string) {
  return (
    <EmptyState
      compact
      className="h-full"
      icon={<KeyRound size={18} />}
      title={title}
      detail={detail}
      action={
        <Button size="sm" variant="subtle" onClick={() => useOverlayStore.getState().openSettings('dev')}>
          Open Settings
        </Button>
      }
    />
  );
}

export function InboxWidget() {
  const { data, isLoading, isError, error, refetch, state, items, counts, sources, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInboxFeed();
  const { handle, unhandle, snooze, unsnooze, handleAll, runAction } = useInboxMutations();
  const view = useInboxUiStore((s) => s.view);
  const source = useInboxUiStore((s) => s.source);
  const acked = useInboxUiStore((s) => s.acked);
  const setView = useInboxUiStore((s) => s.setView);
  const setSource = useInboxUiStore((s) => s.setSource);
  const toggleAck = useInboxUiStore((s) => s.toggleAck);
  const pruneAcked = useInboxUiStore((s) => s.pruneAcked);

  // Drop acks for items that left the open list (only when we saw the whole list).
  useEffect(() => {
    if (state === 'ok' && view === 'open' && source === null && !hasNextPage) {
      pruneAcked(items.map((i) => i.id));
    }
  }, [state, view, source, hasNextPage, items, pruneAcked]);

  // Open view: severity order, acked last, plus the local Ack/Unack action. Other views: newest first.
  const shown = useMemo<InboxItem[]>(() => {
    if (view !== 'open') {
      return items
        .slice()
        .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || b.id - a.id);
    }
    return groupBySeverity(items, (i) => isAckedIn(acked, i)).flatMap((g) =>
      g.items.map((item) => {
        const isAcked = isAckedIn(acked, item);
        const ack: InboxAction = {
          id: isAcked ? UNACK : ACK,
          label: isAcked ? 'Unack' : 'Ack',
          method: 'POST',
          target: '',
        };
        return { ...item, actions: [...(item.actions ?? []), ack] };
      }),
    );
  }, [items, acked, view]);

  async function onAction(itemId: number, actionId: string): Promise<void> {
    if (actionId === ACK || actionId === UNACK) {
      const item = items.find((i) => i.id === itemId);
      if (item) toggleAck(item);
      return;
    }
    try {
      await runAction.mutateAsync({ id: itemId, actionId });
    } catch (err) {
      // useInboxMutations already shows the "Action failed" toast for rejections; this only
      // keeps the ui Inbox from seeing an unhandled rejection.
      if (!(err instanceof Error)) toast.error('Action failed', 'The action could not be run.');
    }
  }

  if (!isLoading && !isError && state === 'offline') {
    return (
      <EmptyState
        compact
        className="h-full"
        icon={<InboxIcon size={18} />}
        title="Inbox is on the PC"
        detail="It shows up here when Nishboard runs on the same PC as the inbox service."
      />
    );
  }
  if (!isLoading && !isError && state === 'no-password') {
    return settingsState('Add the Inbox password', 'Settings → Developer → Inbox.');
  }
  if (!isLoading && !isError && state === 'bad-password') {
    return settingsState('Inbox password not accepted', 'Update it in Settings → Developer → Inbox.');
  }

  const failed = isError && !data;
  return (
    <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden" onClickCapture={openLinksExternally}>
      <Inbox
        className="border-0 rounded-none bg-transparent"
        items={failed ? [] : shown}
        view={view}
        onViewChange={setView}
        counts={counts ?? NO_COUNTS}
        sources={sources}
        source={source}
        onSourceChange={setSource}
        onHandle={(id) => void handle.mutateAsync(id).catch(() => undefined)}
        onUnhandle={(id) => void unhandle.mutateAsync(id).catch(() => undefined)}
        onSnooze={(id, until) => void snooze.mutateAsync({ id, until }).catch(() => undefined)}
        onUnsnooze={(id) => void unsnooze.mutateAsync(id).catch(() => undefined)}
        onHandleAll={() => void handleAll.mutateAsync(source ?? undefined).catch(() => undefined)}
        onAction={onAction}
        loading={isLoading || (!failed && !state)}
        error={failed ? error.message || 'Failed to load the inbox' : null}
        onRetry={() => void refetch()}
        hasMore={Boolean(hasNextPage)}
        onLoadMore={() => void fetchNextPage()}
        loadingMore={isFetchingNextPage}
        sourceLabels={INBOX_SOURCE_LABELS}
      />
    </div>
  );
}
