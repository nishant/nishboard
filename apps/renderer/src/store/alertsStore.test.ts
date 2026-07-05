import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertRule } from './alertsStore';
import { describeRule } from './alertsStore';

describe('describeRule', () => {
  it('summarizes every rule kind', () => {
    expect(describeRule({ id: '1', enabled: true, cooldownMin: 30, kind: 'stock-price', symbol: 'AAPL', dir: 'above', threshold: 200 })).toBe('AAPL above $200');
    expect(describeRule({ id: '2', enabled: true, cooldownMin: 30, kind: 'crypto-price', coinId: 'bitcoin', dir: 'below', thresholdUsd: 60_000 })).toBe('bitcoin below $60,000');
    expect(describeRule({ id: '3', enabled: true, cooldownMin: 30, kind: 'crypto-change', coinId: 'ethereum', magnitudePct: 5 })).toBe('ethereum moves ±5% in 24h');
    expect(describeRule({ id: '4', enabled: true, cooldownMin: 30, kind: 'cpu-sustained', thresholdPct: 85.5, minutes: 10 })).toBe('CPU >85.5% for 10min');
  });
});

describe('useAlertsStore', () => {
  async function loadStore() {
    const mod = await import('./alertsStore');
    return mod.useAlertsStore;
  }

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('addRule assigns an id; toggle and remove target it', async () => {
    const store = await loadStore();
    store.getState().addRule({ enabled: true, cooldownMin: 30, kind: 'stock-price', symbol: 'NVDA', dir: 'above', threshold: 1000 });
    const [rule] = store.getState().rules as AlertRule[];
    expect(rule.id).toBeTruthy();
    expect(rule.kind).toBe('stock-price');

    store.getState().toggleRule(rule.id);
    expect(store.getState().rules[0].enabled).toBe(false);
    store.getState().toggleRule(rule.id);
    expect(store.getState().rules[0].enabled).toBe(true);

    store.getState().removeRule(rule.id);
    expect(store.getState().rules).toHaveLength(0);
  });
});
