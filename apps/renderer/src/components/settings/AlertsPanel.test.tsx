import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsPanel } from './AlertsPanel';
import { useAlertsStore } from '../../store/alertsStore';

// Trading owns the watchlist; the panel only reads it.
vi.mock('../../widgets/stocks/useStocks', () => ({ useWatchlistTickers: () => ['SPY', 'AAPL'] }));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useAlertsStore.setState({ rules: [] });
});

describe('AlertsPanel add-rule flow', () => {
  it('adds a stock rule (nishboard no longer edits the watchlist)', async () => {
    const user = userEvent.setup();
    render(<AlertsPanel />);

    await user.type(screen.getByPlaceholderText('AAPL'), 'nvax');
    await user.type(screen.getByPlaceholderText('250'), '12.5');
    await user.click(screen.getByRole('button', { name: /add alert/i }));

    const rules = useAlertsStore.getState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: 'stock-price', symbol: 'NVAX', dir: 'above', threshold: 12.5, enabled: true });
    // Off trading's watchlist → flagged, not silently added.
    expect(screen.getByText(/not on trading's watchlist — won't fire/)).toBeTruthy();
  });

  it('disables Add for an invalid draft and adds nothing', async () => {
    const user = userEvent.setup();
    render(<AlertsPanel />);

    const addBtn = screen.getByRole('button', { name: /add alert/i });
    expect(addBtn).toHaveProperty('disabled', true); // empty form

    await user.type(screen.getByPlaceholderText('AAPL'), 'AAPL');
    expect(addBtn).toHaveProperty('disabled', true); // still no threshold

    await user.click(addBtn);
    expect(useAlertsStore.getState().rules).toHaveLength(0);
  });

  it('flags rules whose ticker left the watchlist as stranded', () => {
    useAlertsStore.setState({
      rules: [{ id: 'r1', enabled: true, cooldownMin: 30, kind: 'stock-price', symbol: 'GONE', dir: 'above', threshold: 10 }],
    });
    render(<AlertsPanel />);
    expect(screen.getByText(/not on trading's watchlist — won't fire/)).toBeTruthy();
  });
});
