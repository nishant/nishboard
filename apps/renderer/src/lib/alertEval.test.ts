import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CryptoCoinData, CryptoData, HardwareData, StocksData, StockQuote } from '@dash/shared';
import type { AlertRule } from '../store/alertsStore';
import {
  evaluateCpuRules,
  evaluateCryptoRules,
  evaluateStockRules,
  pruneTriggerStates,
  resetTriggerStates,
} from './alertEval';
import { fireAlert } from './alerts';

vi.mock('./alerts', () => ({ fireAlert: vi.fn() }));
const fired = vi.mocked(fireAlert);

const MIN = 60_000;
// Realistic wall-clock base: seeding stores lastFiredAt=0 (epoch), so with a
// real `Date.now()` the first crossing is always past any cooldown. Tiny
// synthetic timestamps would land INSIDE the cooldown window and suppress
// fires that production would deliver.
const T0 = 1_750_000_000_000;
const at = (ms: number): number => T0 + ms;

function quote(ticker: string, lastPrice: number): StockQuote {
  return {
    ticker, lastPrice,
    change: 0, changePercent: 0, bid: 0, ask: 0, volume: 0,
    dayHigh: lastPrice, dayLow: lastPrice, marketOpen: true, sparkline: [],
  };
}

function stocks(...quotes: StockQuote[]): StocksData {
  return { equities: quotes, updatedAt: new Date(0).toISOString() };
}

function coin(id: string, priceUsd: number, change24hPercent = 0): CryptoCoinData {
  return {
    id, symbol: id.slice(0, 3), name: id, image: '',
    priceUsd, change24hPercent, marketCapUsd: 0, sparkline7d: [],
  };
}

function crypto(...coins: CryptoCoinData[]): CryptoData {
  return { coins, updatedAt: new Date(0).toISOString() };
}

function hw(usagePercent: number): HardwareData {
  return {
    cpu: { brand: 'test', cores: 8, physicalCores: 8, usagePercent, coreUsage: [], speedGhz: 3, tempCelsius: null },
    gpu: null,
    ram: { usedMb: 0, totalMb: 0, usagePercent: 0, swapUsedMb: 0, swapTotalMb: 0 },
    disks: [], diskUsage: [], network: [],
    uptime: 0, battery: null, fetchedAt: new Date(0).toISOString(),
  };
}

function stockRule(over: Partial<Extract<AlertRule, { kind: 'stock-price' }>> = {}): AlertRule {
  return { id: 'r-stock', enabled: true, cooldownMin: 30, kind: 'stock-price', symbol: 'AAPL', dir: 'above', threshold: 200, ...over };
}

function cpuRule(over: Partial<Extract<AlertRule, { kind: 'cpu-sustained' }>> = {}): AlertRule {
  return { id: 'r-cpu', enabled: true, cooldownMin: 0, kind: 'cpu-sustained', thresholdPct: 80, minutes: 1, ...over };
}

beforeEach(() => {
  resetTriggerStates();
  fired.mockClear();
});

describe('stock-price rules (edge-triggered state machine)', () => {
  it('seeds silently — an already-true condition at launch never fires', () => {
    const rule = stockRule();
    evaluateStockRules([rule], stocks(quote('AAPL', 250)), at(0));
    expect(fired).not.toHaveBeenCalled();
    // Still held: staying true keeps quiet.
    evaluateStockRules([rule], stocks(quote('AAPL', 260)), at(MIN));
    expect(fired).not.toHaveBeenCalled();
  });

  it('fires exactly once on a false→true crossing', () => {
    const rule = stockRule();
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(0)); // seed armed
    evaluateStockRules([rule], stocks(quote('AAPL', 210)), at(MIN)); // crossing
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith('AAPL above $200', 'AAPL is $210.00');
    // Held: repeated true samples stay silent.
    evaluateStockRules([rule], stocks(quote('AAPL', 220)), at(2 * MIN));
    evaluateStockRules([rule], stocks(quote('AAPL', 230)), at(3 * MIN));
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('drops (not queues) crossings inside the cooldown, re-fires after it', () => {
    const rule = stockRule({ cooldownMin: 30 });
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(0));
    evaluateStockRules([rule], stocks(quote('AAPL', 210)), at(MIN)); // fire #1
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(2 * MIN)); // re-arm
    evaluateStockRules([rule], stocks(quote('AAPL', 210)), at(3 * MIN)); // inside cooldown → dropped
    expect(fired).toHaveBeenCalledTimes(1);
    // The dropped fire is NOT delivered late — a fresh crossing after the
    // cooldown is required.
    evaluateStockRules([rule], stocks(quote('AAPL', 210)), at(40 * MIN)); // still held, no crossing
    expect(fired).toHaveBeenCalledTimes(1);
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(41 * MIN)); // re-arm
    evaluateStockRules([rule], stocks(quote('AAPL', 210)), at(42 * MIN)); // fire #2
    expect(fired).toHaveBeenCalledTimes(2);
  });

  it('treats a missing symbol as "not evaluable" — no transition, no spurious fire', () => {
    const rule = stockRule();
    evaluateStockRules([rule], stocks(quote('AAPL', 250)), at(0)); // seed held
    // Symbol vanishes from the payload (watchlist change, upstream hiccup):
    // held state must survive so recovery doesn't fire.
    evaluateStockRules([rule], stocks(quote('MSFT', 100)), at(MIN));
    evaluateStockRules([rule], stocks(quote('AAPL', 260)), at(2 * MIN));
    expect(fired).not.toHaveBeenCalled();
  });

  it('a rule whose first evaluable sample is true after a missing spell seeds silently', () => {
    const rule = stockRule();
    evaluateStockRules([rule], stocks(quote('MSFT', 100)), at(0)); // not evaluable → no state
    evaluateStockRules([rule], stocks(quote('AAPL', 250)), at(MIN)); // first sample, true → seed, no fire
    expect(fired).not.toHaveBeenCalled();
  });

  it('ignores disabled rules and survives a malformed payload', () => {
    const rule = stockRule({ enabled: false });
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(0));
    evaluateStockRules([rule], stocks(quote('AAPL', 210)), at(MIN));
    expect(fired).not.toHaveBeenCalled();
    // equities missing entirely — must not throw (the evaluator lives at App root).
    const malformed = {} as StocksData;
    expect(() => evaluateStockRules([stockRule()], malformed, at(2 * MIN))).not.toThrow();
    expect(fired).not.toHaveBeenCalled();
  });

  it('respects dir=below', () => {
    const rule = stockRule({ dir: 'below', threshold: 100 });
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(0));
    evaluateStockRules([rule], stocks(quote('AAPL', 90)), at(MIN));
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith('AAPL below $100', 'AAPL is $90.00');
  });
});

describe('crypto rules', () => {
  it('crypto-price fires on threshold crossing', () => {
    const rule: AlertRule = { id: 'c1', enabled: true, cooldownMin: 30, kind: 'crypto-price', coinId: 'bitcoin', dir: 'above', thresholdUsd: 100_000 };
    evaluateCryptoRules([rule], crypto(coin('bitcoin', 90_000)), at(0));
    evaluateCryptoRules([rule], crypto(coin('bitcoin', 110_000)), at(MIN));
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('crypto-change is direction-agnostic on |24h change|', () => {
    const rule: AlertRule = { id: 'c2', enabled: true, cooldownMin: 0, kind: 'crypto-change', coinId: 'ethereum', magnitudePct: 5 };
    evaluateCryptoRules([rule], crypto(coin('ethereum', 3000, 1)), at(0)); // seed armed
    evaluateCryptoRules([rule], crypto(coin('ethereum', 3000, -6.2)), at(MIN)); // big NEGATIVE move
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith('ethereum moves ±5% in 24h', 'ethereum -6.2% in 24h');
  });

  it('survives a malformed crypto payload', () => {
    const rule: AlertRule = { id: 'c3', enabled: true, cooldownMin: 30, kind: 'crypto-price', coinId: 'bitcoin', dir: 'above', thresholdUsd: 1 };
    expect(() => evaluateCryptoRules([rule], {} as CryptoData, at(0))).not.toThrow();
    expect(fired).not.toHaveBeenCalled();
  });
});

describe('cpu-sustained rules', () => {
  it('fires only after the threshold held for the full window', () => {
    const rule = cpuRule({ minutes: 1 });
    evaluateCpuRules([rule], hw(95), at(0)); // seed — spike timer starts now
    evaluateCpuRules([rule], hw(95), at(30_000)); // 30s < 1min
    expect(fired).not.toHaveBeenCalled();
    evaluateCpuRules([rule], hw(95), at(61_000)); // ≥ 1min sustained
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith('CPU >80% for 1min', 'CPU at 95% for over 1min');
  });

  it('a dip below the threshold resets the run', () => {
    const rule = cpuRule({ minutes: 1 });
    evaluateCpuRules([rule], hw(95), at(0));
    evaluateCpuRules([rule], hw(50), at(30_000)); // dip resets
    evaluateCpuRules([rule], hw(95), at(40_000)); // run restarts at 40s
    evaluateCpuRules([rule], hw(95), at(90_000)); // only 50s into the new run
    expect(fired).not.toHaveBeenCalled();
    evaluateCpuRules([rule], hw(95), at(101_000)); // 61s sustained
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('a sampling gap (sleep/hidden) voids the run instead of fabricating evidence', () => {
    const rule = cpuRule({ minutes: 1 });
    evaluateCpuRules([rule], hw(95), at(0)); // seed, timer at 0
    // 2min silence — no proof the CPU stayed high. Run restarts at 120s.
    evaluateCpuRules([rule], hw(95), at(120_000));
    evaluateCpuRules([rule], hw(95), at(150_000)); // 30s into the new run
    expect(fired).not.toHaveBeenCalled();
    evaluateCpuRules([rule], hw(95), at(181_000)); // 61s after the gap sample
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('ignores payloads without a numeric cpu usage', () => {
    const rule = cpuRule();
    expect(() => evaluateCpuRules([rule], {} as HardwareData, at(0))).not.toThrow();
    expect(fired).not.toHaveBeenCalled();
  });
});

describe('pruneTriggerStates', () => {
  it('forgets removed rules so re-adding reseeds silently', () => {
    const rule = stockRule();
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(0)); // seed armed
    pruneTriggerStates(new Set()); // rule deleted/disabled
    // Re-enabled while the condition is ALREADY true: must reseed, not fire.
    evaluateStockRules([rule], stocks(quote('AAPL', 250)), at(MIN));
    expect(fired).not.toHaveBeenCalled();
  });

  it('keeps states for active rules', () => {
    const rule = stockRule();
    evaluateStockRules([rule], stocks(quote('AAPL', 150)), at(0));
    pruneTriggerStates(new Set([rule.id]));
    evaluateStockRules([rule], stocks(quote('AAPL', 250)), at(MIN)); // armed state kept → fires
    expect(fired).toHaveBeenCalledTimes(1);
  });
});
