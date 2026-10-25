import { useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, Plus, X, TrendingUp, TrendingDown } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { useCrypto } from './useCrypto';
import { useCryptoStore } from '../../store/cryptoStore';
import { useCryptoUiStore } from '../../store/cryptoUiStore';
import { ErrorState } from '../../components/ErrorState';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';
import type { CryptoCoinData } from '@dash/shared';
import { EmptyState, SkeletonLines } from '@nish/ui';
import { tk } from '../../lib/tokens';

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Sub-dollar coins need more precision (e.g. DOGE at $0.084)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function CoinCard({ coin }: { coin: CryptoCoinData }) {
  const up = coin.change24hPercent >= 0;
  const color = up ? tk('ok-fill') : tk('loss-fill');
  const points = coin.sparkline7d.map((v) => ({ v }));

  return (
    <div className="bg-th-elevated/50 rounded-lg p-2.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 min-w-0">
        <img src={coin.image} alt="" className="w-4 h-4 rounded-full shrink-0" />
        <span className="text-th-hi text-xs font-medium truncate flex-1 min-w-0">{coin.name}</span>
        <span className="text-th-hi3 text-[10px] uppercase shrink-0">{coin.symbol}</span>
        <span className={`flex items-center gap-0.5 text-[10px] tabular-nums shrink-0 ${up ? 'text-th-ok' : 'text-th-loss'}`}>
          {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {up ? '+' : ''}{coin.change24hPercent.toFixed(2)}%
        </span>
      </div>
      <span className="text-th-hi text-lg leading-none tabular-nums">${fmtPrice(coin.priceUsd)}</span>
      {points.length > 1 && (
        <div className="h-8 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area dataKey="v" stroke={color} strokeWidth={1.2} fill={color} fillOpacity={0.12} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function WatchlistModal({ onClose }: { onClose: () => void }) {
  const { watchlist, addCoin, removeCoin } = useCryptoStore();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const id = input.trim().toLowerCase().replace(/\s+/g, '-');
    if (id) {
      addCoin(id);
      setInput('');
      inputRef.current?.focus();
    }
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-th-scrim/60 rounded-lg">
      <div className="bg-th-surface border border-th-line rounded-xl p-4 w-72 max-h-[80%] flex flex-col gap-3 shadow-pop">
        <div className="flex items-center justify-between">
          <span className="text-th-hi font-semibold text-sm">Edit Coins</span>
          <button onClick={onClose} className="text-th-hi3 hover:text-th-hi transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Add coin id… e.g. bitcoin"
            className="flex-1 bg-th-elevated border border-th-line rounded-lg px-3 py-1.5 text-th-hi text-xs font-mono placeholder:text-th-ghost focus:outline-none focus:border-th-hi3"
            autoFocus
          />
          <button onClick={submit} className="bg-th-overlay hover:bg-th-overlay/70 text-th-hi rounded-lg px-2.5 py-1.5 transition-colors">
            <Plus size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1">
          {watchlist.map((id) => (
            <div key={id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-th-elevated group">
              <span className="font-mono text-th-hi text-xs">{id}</span>
              <button
                onClick={() => removeCoin(id)}
                className="text-th-hi3 hover:text-th-loss transition-colors opacity-0 group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-th-hi3 text-[10px]">
          Use CoinGecko coin <em>ids</em> (the URL slug: coingecko.com/en/coins/<b>bitcoin</b>), not ticker symbols.
          Unknown ids are silently dropped from results.
        </p>
      </div>
    </div>
  );
}

/** WidgetShell header actions: watchlist pencil + refresh. */
export function CryptoActions() {
  const setEditing = useCryptoUiStore((s) => s.setEditing);
  return (
    <>
      <HeaderAction title="Edit coins" onClick={() => setEditing(true)}>
        <Pencil size={11} />
      </HeaderAction>
      <RefreshAction queryKey={['crypto']} title="Refresh prices" />
    </>
  );
}

export function CryptoWidget() {
  const { data, isLoading, isError, error } = useCrypto();
  const { editing, setEditing } = useCryptoUiStore();
  const watchlist = useCryptoStore((s) => s.watchlist);

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {editing && <WatchlistModal onClose={() => setEditing(false)} />}

      <div className="flex-1 overflow-y-auto p-2">
        {watchlist.length === 0 ? (
          <EmptyState compact title="No coins — add one with the pencil" />
        ) : isLoading ? (
          <SkeletonLines lines={4} className="h-full overflow-hidden" />
        ) : isError || !data ? (
          <ErrorState
            message={error instanceof Error && error.message ? error.message : 'Failed to load crypto prices'}
            queryKey={['crypto']}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {data.coins.map((coin) => (
              <CoinCard key={coin.id} coin={coin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
