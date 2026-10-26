import { useEffect, useState } from 'react';
import { Newspaper, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { useNews } from './useNews';
import { relTimeAgo } from '../../lib/time';
import { ErrorState } from '../../components/ErrorState';
import { RefreshAction } from '../../components/RefreshAction';
import { EmptyState, IconButton, SkeletonLines, cn, Label } from '@nish/ui';

/** WidgetShell header actions for the news tile. */
export function NewsActions() {
  return <RefreshAction queryKey={['news']} title="Refresh headlines" />;
}

export function NewsWidget() {
  const { data, isLoading, isError } = useNews();
  const items = data?.items ?? [];
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  // Auto-rotate every 6s (pause on hover).
  useEffect(() => {
    if (paused || items.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000);
    return () => clearInterval(id);
  }, [paused, items.length]);

  useEffect(() => {
    if (idx >= items.length && items.length > 0) setIdx(0);
  }, [items.length, idx]);

  if (isLoading) {
    return <SkeletonLines lines={2} className="h-full overflow-hidden" />;
  }
  if (isError) {
    return <ErrorState message="Couldn't load headlines" queryKey={['news']} />;
  }
  if (items.length === 0) {
    return <EmptyState compact icon={<Newspaper size={16} />} title="No news" />;
  }

  const safeIdx = Math.min(idx, items.length - 1);
  const cur = items[safeIdx];

  return (
    <div
      className="h-full flex flex-col p-3"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-1.5 shrink-0 mb-1">
        <Newspaper className="w-3.5 h-3.5 text-th-hi3" />
        <Label className="text-3xs tracking-widest">Headlines</Label>
        <span className="ml-auto text-th-hi3 text-3xs tabular-nums">{safeIdx + 1}/{items.length}</span>
      </div>

      <button
        onClick={() => window.electron?.openExternal?.(cur.link)}
        className="flex-1 min-h-0 text-left flex flex-col justify-center group overflow-hidden"
        title="Open article in browser"
      >
        <span className="text-th-hi text-sm leading-snug line-clamp-4 group-hover:text-th-accent transition-colors">
          {cur.title}
        </span>
        <span className="text-th-hi3 text-3xs mt-2 flex items-center gap-1 min-w-0">
          <span className="truncate">{cur.source}{cur.pubDate && ` · ${relTimeAgo(cur.pubDate)}`}</span>
          <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition" />
        </span>
      </button>

      <div className="flex items-center justify-between shrink-0 mt-1.5">
        <IconButton label="Previous" size="xs" onClick={() => setIdx((i) => (i - 1 + items.length) % items.length)}>
          <ChevronLeft size={14} />
        </IconButton>
        {/* With >8 items dots can't map 1:1, so show a position counter instead
            of a modulo-highlighted dot that lies about which item is active. */}
        {items.length <= 8 ? (
          <div className="flex gap-1">
            {items.map((_, i) => (
              <span key={i} className={cn('w-1 h-1 rounded-full transition-colors', i === safeIdx ? 'bg-th-hi3' : 'bg-th-line-strong')} />
            ))}
          </div>
        ) : (
          <span className="text-th-hi3 text-3xs tabular-nums">{safeIdx + 1}/{items.length}</span>
        )}
        <IconButton label="Next" size="xs" onClick={() => setIdx((i) => (i + 1) % items.length)}>
          <ChevronRight size={14} />
        </IconButton>
      </div>
    </div>
  );
}
