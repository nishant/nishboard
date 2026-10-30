import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, ArrowLeft, ExternalLink, Star, Briefcase, Unplug } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { useStocks, useStockDetail, useMarketCalendar, useTradingWatchlist } from './useStocks';
import { useOverlayStore } from '../../store/overlayStore';
import { useAppSettingsStore } from '../../store/settingsStore';
import { relTimeUntil, hourFormat } from '../../lib/time';
import { ErrorState } from '../../components/ErrorState';
import { RefreshAction } from '../../components/RefreshAction';
import type { StockQuote, TradingWatchlistData, TradingWatchlistItem } from '@dash/shared';
import { Button, EmptyState, IconButton, Skeleton, SkeletonLines, StatusDot, cardClass, cn, type StatusTone, Label, RelativeTime, useNow } from '@nish/ui';
import { num, pct, signed } from '@nish/ui/format';
import { tk } from '../../lib/tokens';

// ── Market session ────────────────────────────────────────────────────────────

type MarketSession = 'open' | 'after-hours' | 'pre-market' | 'closed';

function getMarketSession(): MarketSession {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const day = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const min = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const total = hour * 60 + min;
  if (day === 'Sat' || day === 'Sun') return 'closed';
  if (total >= 9 * 60 + 30 && total < 16 * 60) return 'open';
  if (total >= 16 * 60 && total < 20 * 60) return 'after-hours';
  if (total >= 4 * 60 && total < 9 * 60 + 30) return 'pre-market';
  return 'closed';
}

function useMarketSession(): MarketSession {
  const [session, setSession] = useState<MarketSession>(getMarketSession);
  useEffect(() => {
    const id = setInterval(() => setSession(getMarketSession()), 60_000);
    return () => clearInterval(id);
  }, []);
  return session;
}

function fmtPrice(n: number): string {
  return num(n, { digits: n >= 10000 ? 0 : 2 });
}


function QuoteCard({ q, badges, onClick }: {
  q: StockQuote;
  /** Trading's per-ticker badges (top-pick score, open position). */
  badges: TradingWatchlistItem | undefined;
  onClick: () => void;
}) {
  const positive = q.change >= 0;
  const color = positive ? 'text-th-ok' : 'text-th-loss';
  const Icon = positive ? TrendingUp : TrendingDown;

  return (
    <button
      onClick={onClick}
      title={`${q.ticker} — chart & news`}
      className={cardClass({ variant: 'inset', interactive: true, padding: 'none', className: 'p-2.5 flex flex-col gap-1 min-w-0 text-left' })}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1 min-w-0">
          <Icon size={12} className={cn(color, 'shrink-0')} />
          <span className="font-mono font-bold text-th-hi text-sm leading-none truncate">
            {q.ticker}
          </span>
          {badges?.topPickScore != null && (
            <span
              className="flex items-center gap-0.5 text-3xs text-th-warn font-mono tabular-nums shrink-0"
              title={`Trading top pick score ${num(badges.topPickScore, { digits: 1 })} / 100${badges.topPickStrategy ? ` · ${badges.topPickStrategy.replace(/_/g, ' ')}` : ''}`}
            >
              <Star size={10} aria-hidden="true" />
              {num(badges.topPickScore, { digits: 0 })}
            </span>
          )}
          {badges?.openPosition && (
            <span
              className="text-th-info shrink-0"
              title={`Open position in trading${badges.openPositionCount > 1 ? ` (${badges.openPositionCount})` : ''}`}
              aria-label="Open position"
              role="img"
            >
              <Briefcase size={10} aria-hidden="true" />
            </span>
          )}
        </div>
        <span className={cn('font-mono text-xs tabular-nums shrink-0', color)}>
          {pct(q.changePercent, { fromRatio: false, digits: 2, signed: true })}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono text-th-hi text-base font-semibold tabular-nums leading-none">
          {fmtPrice(q.lastPrice)}
        </span>
        <span className={cn('font-mono text-xs tabular-nums shrink-0', color)}>
          {signed(q.change)}
        </span>
      </div>
    </button>
  );
}

// ── Detail panel: intraday chart + recent news ────────────────────────────────

function StockDetailPanel({ ticker, onClose }: { ticker: string; onClose: () => void }) {
  const { data, isLoading, isError } = useStockDetail(ticker);
  const clock24h = useAppSettingsStore((s) => s.clock24h);
  const bars = data?.bars ?? [];
  const news = data?.news ?? [];
  const range = data?.range ?? 'intraday';
  const first = bars[0]?.c ?? 0;
  const last = bars[bars.length - 1]?.c ?? 0;
  const up = last >= first;
  const color = up ? tk('ok-fill') : tk('loss-fill');
  const gradId = `stk-${ticker}`;
  const rangeLabel = range === 'daily' ? 'Daily · ~2mo' : 'Intraday';

  return (
    <div className="absolute inset-0 z-10 bg-th-surface rounded-lg flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-th-line shrink-0">
        <IconButton label="Back" size="xs" onClick={onClose}>
          <ArrowLeft size={15} />
        </IconButton>
        <span className="font-mono font-bold text-th-hi text-sm">{ticker}</span>
        {bars.length > 0 && (
          <>
            <Label className="text-3xs">{rangeLabel}</Label>
            <span className={cn('ml-auto font-mono text-xs tabular-nums', up ? 'text-th-ok' : 'text-th-loss')}>
              {fmtPrice(last)}
            </span>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        {/* Intraday chart */}
        <div className="h-28 shrink-0">
          {isLoading ? (
            <Skeleton className="h-full w-full" />
          ) : isError ? (
            <ErrorState message="Failed to load chart" queryKey={['stock-detail', ticker]} />
          ) : bars.length === 0 ? (
            <div className="h-full flex items-center justify-center text-th-hi3 text-xs">No chart data available</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={bars} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={['dataMin', 'dataMax']} hide />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: tk('ghost'), strokeWidth: 1 }}
                  contentStyle={{ background: tk('elevated'), border: `1px solid ${tk('line')}`, color: tk('hi'), borderRadius: 'var(--nish-radius-sm)', fontSize: 11 }}
                  labelFormatter={(t) =>
                    range === 'daily'
                      ? new Date(String(t)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : new Date(String(t)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...hourFormat(clock24h) })
                  }
                  formatter={(v) => [fmtPrice(Number(v)), 'Price']}
                />
                <Area type="monotone" dataKey="c" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* News */}
        <div className="flex flex-col gap-2">
          <Label className="text-3xs tracking-widest">Recent News</Label>
          {isLoading ? null : news.length === 0 ? (
            <span className="text-th-hi3 text-xs">No recent news</span>
          ) : (
            news.map((n, i) => (
              <button
                key={i}
                onClick={() => window.electron?.openExternal?.(n.url)}
                className="text-left group flex flex-col gap-0.5"
                title="Open article in browser"
              >
                <span className="text-th-hi2 text-xs leading-snug line-clamp-2 group-hover:text-th-accent transition-colors flex items-start gap-1">
                  {n.headline}
                  <ExternalLink className="w-2.5 h-2.5 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition" />
                </span>
                <span className="text-th-hi3 text-3xs">{n.source}{n.createdAt && <> · <RelativeTime value={n.createdAt} /></>}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Not connected to trading — no token, rejected token, or trading off the
 *  tailnet. Alpaca quotes need trading's ticker list, so nothing else renders. */
function NotConnected({ data }: { data: Extract<TradingWatchlistData, { connected: false }> }) {
  const openSettings = useOverlayStore((s) => s.openSettings);
  const queryClient = useQueryClient();
  // Popouts (?widget=…) have no Settings modal to open.
  const inPopout = new URLSearchParams(window.location.search).has('widget');
  const title =
    data.reason === 'unauthorized' ? 'Trading token rejected'
    : data.reason === 'unreachable' ? 'Trading unreachable'
    : data.reason === 'error' ? 'Trading error'
    : 'Not connected to trading';
  const needsSettings = data.reason === 'not-configured' || data.reason === 'unauthorized' || data.reason === 'error';
  return (
    <EmptyState
      compact
      className="h-full"
      icon={<Unplug size={14} />}
      title={title}
      detail={data.message}
      action={
        needsSettings && !inPopout ? (
          <Button size="sm" variant="secondary" onClick={() => openSettings('dev')}>
            Open Settings → Developer
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void queryClient.refetchQueries({ queryKey: ['stocks', 'watchlist'] })}>
            Retry
          </Button>
        )
      }
    />
  );
}

/** WidgetShell header actions: refresh. The ['stocks'] prefix covers both the
 *  trading watchlist and the quotes. The watchlist is edited in trading, never here. */
export function StocksActions() {
  return <RefreshAction queryKey={['stocks']} title="Refresh watchlist + quotes" />;
}

export function StocksWidget() {
  const watchlist = useTradingWatchlist();
  const { data, isLoading, isError, error } = useStocks();
  const [selected, setSelected] = useState<string | null>(null);
  const session = useMarketSession();
  const connected = watchlist.data?.connected ? watchlist.data : null;
  const badgeMap = new Map((connected?.items ?? []).map((i) => [i.ticker, i]));
  const calendar = useMarketCalendar().data;

  // Dedicated tick for the countdown text — useMarketSession's setState bails
  // out when the session label hasn't changed, so it can't drive re-renders.
  const now = useNow(30_000);

  // No pulse: the dot marks the market session, not a live feed — prices
  // refresh on a 5-minute poll (deliberate; keeps Alpaca usage minimal).
  const sessionTone: Record<MarketSession, StatusTone> = {
    open:         'ok',
    'after-hours': 'warn',
    'pre-market':  'warn',
    closed:       'loss',
  };
  const sessionLabel: Record<MarketSession, string> = {
    open:         'Market Open',
    'after-hours': 'After Hours',
    'pre-market':  'Pre-Market',
    closed:       'Market Closed · Last close',
  };

  // Holiday-aware countdown from the Alpaca calendar; the Intl heuristic above
  // stays as the fallback (and drives the pre/after-hours dot color either way).
  let badge = sessionLabel[session];
  if (calendar) {
    if (calendar.isOpen && calendar.nextClose) {
      badge = `Market Open · closes ${relTimeUntil(new Date(calendar.nextClose).getTime(), now)}`;
    } else if (!calendar.isOpen && calendar.nextOpen) {
      const state = session === 'closed' ? 'Market Closed' : sessionLabel[session];
      badge = `${state} · opens ${relTimeUntil(new Date(calendar.nextOpen).getTime(), now)}`;
    }
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {selected && <StockDetailPanel ticker={selected} onClose={() => setSelected(null)} />}

      <div className="flex items-center px-3 py-1.5 border-b border-th-line shrink-0">
        <span
          className="text-3xs flex items-center gap-1.5 text-th-hi3"
          title="Prices refresh every 5 minutes"
        >
          <StatusDot tone={sessionTone[session]} size="xs" />
          {badge}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {watchlist.data && !watchlist.data.connected && <NotConnected data={watchlist.data} />}
        {watchlist.isError && (
          <ErrorState message="Couldn't load the trading watchlist" queryKey={['stocks', 'watchlist']} />
        )}
        {connected && connected.items.length === 0 && (
          <EmptyState compact className="h-full" title="Trading's watchlist is empty" detail="Add tickers in trading — they show up here." />
        )}
        {(watchlist.isLoading || isLoading) && <SkeletonLines lines={4} className="h-full overflow-hidden" />}
        {connected && isError && (
          // Surface the server's message (e.g. the missing-keys pointer to
          // Settings → Developer) rather than a generic failure string.
          <ErrorState
            message={error instanceof Error && error.message ? error.message : 'Failed to load market data'}
            queryKey={['stocks']}
          />
        )}
        {connected && data && (
          <div className="grid grid-cols-2 gap-2">
            {data.equities.map((q) => (
              <QuoteCard
                key={q.ticker}
                q={q}
                badges={badgeMap.get(q.ticker)}
                onClick={() => setSelected(q.ticker)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
