import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsPanel } from './AlertsPanel';
import { useAlertsStore } from '../../store/alertsStore';
import { useStocksStore } from '../../store/stocksStore';

beforeEach(() => {
  cleanup();
  localStorage.clear();
  useAlertsStore.setState({ rules: [] });
  useStocksStore.setState({ watchlist: ['SPY', 'AAPL'] });
});

describe('AlertsPanel add-rule flow', () => {
  it('adding a stock rule also adds the ticker to the stocks watchlist', async () => {
    const user = userEvent.setup();
    render(<AlertsPanel />);

    // Off-watchlist ticker: without the auto-add the rule would never evaluate
    // (the stocks query only fetches watchlist symbols).
    await user.type(screen.getByPlaceholderText('AAPL'), 'nvax');
    await user.type(screen.getByPlaceholderText('250'), '12.5');
    await user.click(screen.getByRole('button', { name: /add alert/i }));

    const rules = useAlertsStore.getState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ kind: 'stock-price', symbol: 'NVAX', dir: 'above', threshold: 12.5, enabled: true });
    expect(useStocksStore.getState().watchlist).toContain('NVAX');
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
    expect(useStocksStore.getState().watchlist).toEqual(['SPY', 'AAPL']);
  });

  it('flags rules whose ticker left the watchlist as stranded', () => {
    useAlertsStore.setState({
      rules: [{ id: 'r1', enabled: true, cooldownMin: 30, kind: 'stock-price', symbol: 'GONE', dir: 'above', threshold: 10 }],
    });
    render(<AlertsPanel />);
    expect(screen.getByText(/not in watchlist — won't fire/)).toBeTruthy();
  });
});
