import { useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, Plus, X, TrendingUp, TrendingDown } from 'lucide-react';
import { useCrypto } from './useCrypto';
import { useCryptoStore } from '../../store/cryptoStore';
import { useCryptoUiStore } from '../../store/cryptoUiStore';
import { ErrorState } from '../../components/ErrorState';
import { HeaderAction } from '../../components/HeaderAction';
import { RefreshAction } from '../../components/RefreshAction';
import type { CryptoCoinData } from '@dash/shared';
import { Card, EmptyState, IconButton, Modal, SkeletonLines, Sparkline, cn } from '@nish/ui';
import { Input } from '../../components/nishGaps';

function fmtPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Sub-dollar coins need more precision (e.g. DOGE at $0.084)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function CoinCard({ coin }: { coin: CryptoCoinData }) {
  const up = coin.change24hPercent >= 0;

  return (
    // @container: in a small tile the change % wraps under the name instead of
    // running past the card's right edge.
    <Card variant="inset" padding="none" className="@container p-2.5 flex flex-col gap-1.5 min-w-0">
      <div className="flex items-center gap-x-1.5 gap-y-0.5 min-w-0 @max-[8rem]:flex-wrap">
        <img src={coin.image} alt="" className="w-4 h-4 rounded-full shrink-0" />
        <span className="text-th-hi text-xs font-medium truncate flex-1 min-w-0">{coin.name}</span>
        <span className="text-th-hi3 text-[10px] uppercase shrink-0">{coin.symbol}</span>
        <span className={cn('flex items-center gap-0.5 text-[10px] tabular-nums shrink-0 @max-[8rem]:basis-full', up ? 'text-th-ok' : 'text-th-loss')}>
          {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
          {up ? '+' : ''}{coin.change24hPercent.toFixed(2)}%
        </span>
      </div>
      <span className="text-th-hi text-lg leading-none tabular-nums">${fmtPrice(coin.priceUsd)}</span>
      {coin.sparkline7d.length > 1 && (
        <div className="crypto-spark h-8">
          <Sparkline
            values={coin.sparkline7d}
            label={`${coin.name} price, last 7 days`}
            tone={up ? 'ok' : 'loss'}
            height={32}
            fill
            className="w-full"
          />
        </div>
      )}
    </Card>
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
  }

  return (
    <Modal title="Edit Coins" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            size="sm"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder="Add coin id… e.g. bitcoin"
            aria-label="Coin id"
            className="flex-1 font-mono"
            autoFocus
          />
          <IconButton label="Add coin" size="sm" variant="subtle" onClick={submit}>
            <Plus size={14} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-1">
          {watchlist.map((id) => (
            <Card key={id} variant="inset" padding="none" className="flex items-center justify-between px-2.5 py-1 group">
              <span className="font-mono text-th-hi text-xs">{id}</span>
              <IconButton
                label={`Remove ${id}`}
                size="xs"
                tone="danger"
                onClick={() => removeCoin(id)}
                className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              >
                <X size={12} />
              </IconButton>
            </Card>
          ))}
        </div>

        <p className="text-th-hi3 text-[10px]">
          Use CoinGecko coin <em>ids</em> (the URL slug: coingecko.com/en/coins/<b>bitcoin</b>), not ticker symbols.
          Unknown ids are silently dropped from results.
        </p>
      </div>
    </Modal>
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

      {/* crypto-list: a size container, so a tile too short for a whole card
          drops the sparklines instead of cutting them off (index.css). */}
      <div className="crypto-list flex-1 min-h-0 overflow-y-auto p-2">
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
