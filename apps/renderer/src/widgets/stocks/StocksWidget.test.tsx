import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StockQuote, StocksData, TradingWatchlistData } from '@dash/shared';
import { StocksWidget } from './StocksWidget';
import { useOverlayStore } from '../../store/overlayStore';

// Trading is the single source of truth for the watchlist: the widget renders
// a not-connected state from the proxy's discriminated payload, and badges
// from trading's per-ticker summary.

function quote(ticker: string): StockQuote {
  return {
    ticker, lastPrice: 100, change: 1, changePercent: 1, bid: 0, ask: 0,
    volume: 0, dayHigh: 0, dayLow: 0, marketOpen: true, sparkline: [],
  };
}

function renderWidget(watchlist: TradingWatchlistData, stocks?: StocksData) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['stocks', 'watchlist'], watchlist);
  if (stocks && watchlist.connected) {
    queryClient.setQueryData(['stocks', watchlist.items.map((i) => i.ticker)], stocks);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <StocksWidget />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network disabled in test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StocksWidget trading watchlist', () => {
  it('shows "not connected" with a Settings → Developer shortcut when no token is set', () => {
    renderWidget({ connected: false, reason: 'not-configured', message: 'Add its read-only API token.' });
    expect(screen.getByText('Not connected to trading')).toBeTruthy();
    screen.getByRole('button', { name: /open settings/i }).click();
    expect(useOverlayStore.getState().settingsOpen).toBe(true);
    expect(useOverlayStore.getState().settingsTab).toBe('dev');
  });

  it('shows a retry (not Settings) when trading is unreachable', () => {
    renderWidget({ connected: false, reason: 'unreachable', message: 'Trading is unreachable.' });
    expect(screen.getByText('Trading unreachable')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open settings/i })).toBeNull();
  });

  it('renders trading tickers with score + open-position badges (no badge for a null score)', () => {
    renderWidget(
      {
        connected: true,
        scannedAt: null,
        updatedAt: '2026-10-30T15:00:00Z',
        items: [
          { ticker: 'AAPL', topPickScore: 74.9, topPickStrategy: 'long_call', openPosition: true, openPositionCount: 1 },
          { ticker: 'MSFT', topPickScore: null, topPickStrategy: null, openPosition: false, openPositionCount: 0 },
        ],
      },
      { equities: [quote('AAPL'), quote('MSFT')], updatedAt: '2026-10-30T15:00:00Z' },
    );
    expect(screen.getByText('AAPL')).toBeTruthy();
    expect(screen.getByText('MSFT')).toBeTruthy();
    expect(screen.getByTitle(/top pick score 74\.9/i)).toBeTruthy();
    expect(screen.getAllByTitle(/top pick score/i)).toHaveLength(1);
    expect(screen.getAllByLabelText('Open position')).toHaveLength(1);
  });
});
