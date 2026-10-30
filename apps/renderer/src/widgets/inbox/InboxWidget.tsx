import { useEffect, useMemo, useState } from 'react';
import { Check, Clock, ExternalLink, Eye, EyeOff, Inbox, KeyRound } from 'lucide-react';
import {
  Button,
  Chip,
  ChipGroup,
  ConfirmDialog,
  DropdownMenu,
  EmptyState,
  IconButton,
  INBOX_SOURCE_LABELS,
  MenuItem,
  RelativeTime,
  SkeletonLines,
  StatusDot,
  cn,
} from '@nish/ui';
import type { InboxItemData, InboxSeverityData, InboxViewData } from '@dash/shared';
import { useInboxFeed, useInboxMutations } from './useInbox';
import { SNOOZE_OPTIONS, groupBySeverity, safeHref } from './inboxSort';
import { isAckedIn, useInboxUiStore } from '../../store/inboxUiStore';
import { useOverlayStore } from '../../store/overlayStore';
import { ErrorState } from '../../components/ErrorState';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';

const SEVERITY_LABEL: Record<InboxSeverityData, string> = { urgent: 'Urgent', normal: 'Normal', info: 'Info' };
const SEVERITY_TONE = { urgent: 'loss', normal: 'accent', info: 'neutral' } as const;
const TOUCH = 'pointer-coarse:min-h-11 pointer-coarse:min-w-11';

function sourceLabel(id: string): string {
  return INBOX_SOURCE_LABELS[id] ?? id;
}

function openLink(href: string): void {
  window.electron?.openExternal?.(href);
}

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

interface RowProps {
  item: InboxItemData;
  view: InboxViewData;
  acked: boolean;
  busy: boolean;
  onAck: () => void;
  onSnooze: (until: Date) => void;
  onResolve: () => void;
  onUnsnooze: () => void;
  onUnhandle: () => void;
}

function InboxRow({ item, view, acked, busy, onAck, onSnooze, onResolve, onUnsnooze, onUnhandle }: RowProps) {
  const severity: InboxSeverityData = item.severity === 'urgent' || item.severity === 'info' ? item.severity : 'normal';
  const href = safeHref(item.url);
  const dimmed = view === 'open' && acked;

  return (
    <li className={cn('flex items-start gap-2 px-2 py-1.5', dimmed && 'opacity-60')}>
      <StatusDot tone={SEVERITY_TONE[severity]} label={SEVERITY_LABEL[severity]} className="mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-3xs text-th-hi3 flex flex-wrap gap-x-1.5">
          <span>{sourceLabel(item.source)}</span>
          <RelativeTime value={item.updatedAt} style="short" />
          {item.count > 1 && <span aria-label={`Happened ${item.count} times`}>×{item.count}</span>}
          {dimmed && <span>Acked</span>}
        </div>
        {href ? (
          <button
            type="button"
            onClick={() => openLink(href)}
            className="max-w-full text-xs font-medium text-th-hi line-clamp-2 break-words hover:underline text-left"
          >
            {item.title}
          </button>
        ) : (
          <div className="text-xs font-medium text-th-hi line-clamp-2 break-words">{item.title}</div>
        )}
        {item.body && (
          <div className="text-2xs text-th-hi2 line-clamp-2 break-words whitespace-pre-line">{item.body}</div>
        )}
        {view === 'snoozed' && item.snoozedUntil && (
          <div className="text-3xs text-th-hi3">
            Until{' '}
            {new Date(item.snoozedUntil).toLocaleString(undefined, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </div>
        )}
        {view === 'handled' && item.handledAt && (
          <div className="text-3xs text-th-hi3">
            Resolved <RelativeTime value={item.handledAt} style="short" />
            {item.handledBy === 'source' ? ' by the app' : item.handledBy === 'expired' ? ' automatically' : ''}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-0.5">
        {view === 'open' && (
          <>
            <IconButton
              label={acked ? 'Un-ack' : 'Ack'}
              size="2xs"
              className={TOUCH}
              disabled={busy}
              onClick={onAck}
            >
              {acked ? <EyeOff size={12} /> : <Eye size={12} />}
            </IconButton>
            <DropdownMenu
              align="end"
              aria-label="Snooze until"
              trigger={
                <IconButton label="Snooze" size="2xs" className={TOUCH} disabled={busy}>
                  <Clock size={12} />
                </IconButton>
              }
            >
              {SNOOZE_OPTIONS.map((opt) => (
                <MenuItem key={opt.label} onSelect={() => onSnooze(opt.until(new Date()))}>
                  {opt.label}
                </MenuItem>
              ))}
            </DropdownMenu>
            <IconButton label="Resolve" size="2xs" className={TOUCH} disabled={busy} onClick={onResolve}>
              <Check size={12} />
            </IconButton>
          </>
        )}
        {view === 'snoozed' && (
          <Button size="xs" variant="subtle" disabled={busy} onClick={onUnsnooze}>
            Unsnooze
          </Button>
        )}
        {view === 'handled' && (
          <Button size="xs" variant="subtle" disabled={busy} onClick={onUnhandle}>
            Move back
          </Button>
        )}
      </div>
    </li>
  );
}

export function InboxWidget() {
  const { data, isLoading, isError, error, state, items, counts, sources, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInboxFeed();
  const { handle, unhandle, snooze, unsnooze, handleAll } = useInboxMutations();
  const view = useInboxUiStore((s) => s.view);
  const source = useInboxUiStore((s) => s.source);
  const acked = useInboxUiStore((s) => s.acked);
  const setView = useInboxUiStore((s) => s.setView);
  const setSource = useInboxUiStore((s) => s.setSource);
  const toggleAck = useInboxUiStore((s) => s.toggleAck);
  const pruneAcked = useInboxUiStore((s) => s.pruneAcked);
  const [confirmAll, setConfirmAll] = useState(false);

  // Drop acks for items that left the open list (only when we saw the whole list).
  useEffect(() => {
    if (state === 'ok' && view === 'open' && source === null && !hasNextPage) {
      pruneAcked(items.map((i) => i.id));
    }
  }, [state, view, source, hasNextPage, items, pruneAcked]);

  const groups = useMemo(
    () => (view === 'open' ? groupBySeverity(items, (i) => isAckedIn(acked, i)) : []),
    [items, acked, view],
  );
  const flat = useMemo(
    () =>
      view === 'open'
        ? []
        : items.slice().sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || b.id - a.id),
    [items, view],
  );

  // Track every in-flight call per row (a single useMutation only remembers the latest).
  const [pending, setPending] = useState<ReadonlySet<number>>(() => new Set());
  function track(id: number, run: Promise<unknown>) {
    setPending((p) => new Set(p).add(id));
    // Errors are surfaced by the mutation's own onError; this only clears the busy flag.
    void run
      .catch(() => undefined)
      .finally(() =>
        setPending((p) => {
          const n = new Set(p);
          n.delete(id);
          return n;
        }),
      );
  }

  const sourceSuffix = source ? ` from ${sourceLabel(source)}` : '';
  const resolveCount = source ? (sources.find((s) => s.id === source)?.open ?? items.length) : (counts?.open ?? items.length);

  function renderRow(item: InboxItemData) {
    return (
      <InboxRow
        key={item.id}
        item={item}
        view={view}
        acked={isAckedIn(acked, item)}
        busy={pending.has(item.id)}
        onAck={() => toggleAck(item)}
        onSnooze={(until) => track(item.id, snooze.mutateAsync({ id: item.id, until }))}
        onResolve={() => track(item.id, handle.mutateAsync(item.id))}
        onUnsnooze={() => track(item.id, unsnooze.mutateAsync(item.id))}
        onUnhandle={() => track(item.id, unhandle.mutateAsync(item.id))}
      />
    );
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

  function body() {
    if (isError && !data) return <ErrorState message={error.message || 'Failed to load the inbox'} queryKey={['inbox']} />;
    if (isLoading || !state) return <SkeletonLines lines={4} className="p-2" />;
    if (state === 'offline') {
      return (
        <EmptyState
          compact
          className="h-full"
          icon={<Inbox size={18} />}
          title="Inbox is on the PC"
          detail="It shows up here when Nishboard runs on the same PC as the inbox service."
        />
      );
    }
    if (state === 'no-password') return settingsState('Add the Inbox password', 'Settings → Developer → Inbox.');
    if (state === 'bad-password') {
      return settingsState('Inbox password not accepted', 'Update it in Settings → Developer → Inbox.');
    }
    if (items.length === 0) {
      const title =
        view === 'open' ? 'Nothing open' : view === 'snoozed' ? 'Nothing snoozed' : 'Nothing handled in the last 30 days';
      return <EmptyState compact className="h-full" title={`${title}${sourceSuffix}`} />;
    }
    return (
      <>
        {view === 'open' ? (
          groups.map((g) => (
            <section key={g.severity}>
              <div className="px-2 pt-2 pb-1 text-3xs uppercase tracking-wide text-th-hi3">
                {SEVERITY_LABEL[g.severity]} · {g.items.length}
              </div>
              <ul className="divide-y divide-th-line">{g.items.map(renderRow)}</ul>
            </section>
          ))
        ) : (
          <ul className="divide-y divide-th-line">{flat.map(renderRow)}</ul>
        )}
        {hasNextPage && (
          <div className="flex justify-center p-2">
            <Button size="sm" variant="ghost" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {state === 'ok' && counts && (
        <div className="px-2 pt-2 pb-1 flex items-center gap-1.5 flex-wrap">
          <ChipGroup label="Inbox view" className="min-w-0">
            <Chip size="sm" pressed={view === 'open'} onClick={() => setView('open')}>
              Open {counts.open}
            </Chip>
            <Chip size="sm" pressed={view === 'snoozed'} onClick={() => setView('snoozed')}>
              Snoozed {counts.snoozed}
            </Chip>
            <Chip size="sm" pressed={view === 'handled'} onClick={() => setView('handled')}>
              Handled
            </Chip>
          </ChipGroup>
          {view === 'open' && items.length > 0 && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirmAll(true)}>
              Resolve all
            </Button>
          )}
          {(sources.length > 1 || source !== null) && (
            <ChipGroup label="Filter by source" scroll className="basis-full min-w-0">
              <Chip size="sm" pressed={source === null} onClick={() => setSource(null)}>
                All
              </Chip>
              {sources.map((s) => (
                <Chip
                  key={s.id}
                  size="sm"
                  pressed={source === s.id}
                  onClick={() => setSource(s.id)}
                  trailing={<span className="text-th-hi3 tabular-nums">{s.open}</span>}
                >
                  {sourceLabel(s.id)}
                </Chip>
              ))}
            </ChipGroup>
          )}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">{body()}</div>
      {confirmAll && (
        <ConfirmDialog
          title={`Resolve ${resolveCount === 1 ? '1 item' : `${resolveCount} items`}?`}
          confirmLabel="Resolve"
          pending={handleAll.isPending}
          onCancel={() => setConfirmAll(false)}
          onConfirm={() =>
            handleAll.mutate(source ?? undefined, { onSettled: () => setConfirmAll(false) })
          }
        />
      )}
    </div>
  );
}
