import type { CryptoData, HardwareData, StocksData } from '@dash/shared';
import type { AlertRule } from '../store/alertsStore';
import { describeRule } from '../store/alertsStore';
import { fireAlert } from './alerts';

// Edge-triggered firing state machine, one entry per rule id. In-memory on
// purpose: the first evaluation after launch seeds silently from the live
// condition, so persisted state could only disagree with reality (the sole
// loss is cooldown continuity across restarts, which seeding neutralizes).
interface TriggerState {
  phase: 'armed' | 'held';
  lastFiredAt: number;
  /** cpu-sustained only: wall-clock start of the current above-threshold run. */
  cpuAboveSince: number | null;
  /** cpu-sustained only: gap detection across hidden/sleep/server-restart. */
  lastSampleAt: number;
}

const triggerStates = new Map<string, TriggerState>();

/** A sampling gap longer than this voids a cpu-sustained run — no evidence the
 *  CPU stayed high while we weren't looking. */
const CPU_GAP_MS = 60_000;

/** Rule disabled or deleted → forget its state; re-enabling reseeds silently. */
export function pruneTriggerStates(activeRuleIds: Set<string>): void {
  for (const id of triggerStates.keys()) {
    if (!activeRuleIds.has(id)) triggerStates.delete(id);
  }
}

/** Test hook — resets all runtime state (module map survives HMR/remounts). */
export function resetTriggerStates(): void {
  triggerStates.clear();
}

/**
 * Advance one rule's state machine with a freshly evaluated condition.
 * `cond === undefined` means "not evaluable" (symbol missing from the
 * response, query error) and causes NO transition — treating missing data as
 * false would re-arm the rule and fire spuriously on recovery.
 */
function step(rule: AlertRule, cond: boolean | undefined, detail: string, now: number): void {
  if (cond === undefined) return;

  const st = triggerStates.get(rule.id);
  if (!st) {
    // First evaluable sample after launch/enable: seed silently, never fire.
    triggerStates.set(rule.id, {
      phase: cond ? 'held' : 'armed',
      lastFiredAt: 0,
      cpuAboveSince: null,
      lastSampleAt: now,
    });
    return;
  }

  st.lastSampleAt = now;
  if (st.phase === 'armed' && cond) {
    if (now - st.lastFiredAt >= rule.cooldownMin * 60_000) {
      fireAlert(describeRule(rule), detail);
      st.lastFiredAt = now;
    }
    // Cooldown-suppressed fires are dropped, not queued: edge-triggered means
    // the next fire requires a fresh false→true crossing.
    st.phase = 'held';
  } else if (st.phase === 'held' && !cond) {
    st.phase = 'armed';
  }
}

export function evaluateStockRules(rules: AlertRule[], data: StocksData, now: number): void {
  // Runtime guard: the evaluator lives at the App root — a malformed payload
  // must degrade to "not evaluable", never crash the shell.
  const equities = Array.isArray(data.equities) ? data.equities : [];
  for (const rule of rules) {
    if (rule.kind !== 'stock-price' || !rule.enabled) continue;
    const q = equities.find((e) => e.ticker === rule.symbol.toUpperCase());
    const cond = q ? (rule.dir === 'above' ? q.lastPrice > rule.threshold : q.lastPrice < rule.threshold) : undefined;
    step(rule, cond, q ? `${q.ticker} is $${q.lastPrice.toFixed(2)}` : '', now);
  }
}

export function evaluateCryptoRules(rules: AlertRule[], data: CryptoData, now: number): void {
  const coins = Array.isArray(data.coins) ? data.coins : [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.kind === 'crypto-price') {
      const c = coins.find((x) => x.id === rule.coinId);
      const cond = c
        ? (rule.dir === 'above' ? c.priceUsd > rule.thresholdUsd : c.priceUsd < rule.thresholdUsd)
        : undefined;
      step(rule, cond, c ? `${c.name} is $${c.priceUsd.toLocaleString('en-US')}` : '', now);
    } else if (rule.kind === 'crypto-change') {
      const c = coins.find((x) => x.id === rule.coinId);
      const cond = c ? Math.abs(c.change24hPercent) >= rule.magnitudePct : undefined;
      step(rule, cond, c ? `${c.name} ${c.change24hPercent > 0 ? '+' : ''}${c.change24hPercent.toFixed(1)}% in 24h` : '', now);
    }
  }
}

export function evaluateCpuRules(rules: AlertRule[], data: HardwareData, now: number): void {
  const usage: unknown = data.cpu?.usagePercent;
  if (typeof usage !== 'number') return;
  for (const rule of rules) {
    if (rule.kind !== 'cpu-sustained' || !rule.enabled) continue;
    const above = usage > rule.thresholdPct;

    let st = triggerStates.get(rule.id);
    if (!st) {
      // Seed: an in-progress spike at launch starts the timer now — the rule
      // still can't fire before a full observed `minutes` span.
      st = {
        phase: 'armed',
        lastFiredAt: 0,
        cpuAboveSince: above ? now : null,
        lastSampleAt: now,
      };
      triggerStates.set(rule.id, st);
      return;
    }

    // Gap rule: hidden window / sleep / server restart → restart the run.
    if (now - st.lastSampleAt > CPU_GAP_MS) {
      st.cpuAboveSince = above ? now : null;
      st.lastSampleAt = now;
      if (st.phase === 'held' && !above) st.phase = 'armed';
      return;
    }

    if (above) {
      st.cpuAboveSince ??= now;
    } else {
      st.cpuAboveSince = null;
    }
    const cond = st.cpuAboveSince !== null && now - st.cpuAboveSince >= rule.minutes * 60_000;
    step(rule, cond, `CPU at ${Math.round(usage)}% for over ${rule.minutes}min`, now);
  }
}
