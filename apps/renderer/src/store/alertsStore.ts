import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const DEFAULT_COOLDOWN_MIN = 30;

interface AlertRuleBase {
  id: string;
  enabled: boolean;
  /** Minimum minutes between fires of this rule (edge-triggered on top). */
  cooldownMin: number;
}

export type AlertRule = AlertRuleBase &
  (
    | { kind: 'stock-price'; symbol: string; dir: 'above' | 'below'; threshold: number }
    | { kind: 'crypto-price'; coinId: string; dir: 'above' | 'below'; thresholdUsd: number }
    // |24h change| >= magnitude — direction-agnostic "big move" alarm.
    | { kind: 'crypto-change'; coinId: string; magnitudePct: number }
    | { kind: 'cpu-sustained'; thresholdPct: number; minutes: number }
  );

export type AlertRuleKind = AlertRule['kind'];

// Plain Omit on a discriminated union collapses it to the common keys —
// distribute it so per-kind fields survive.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewAlertRule = DistributiveOmit<AlertRule, 'id'>;

interface AlertsState {
  rules: AlertRule[];
  addRule: (rule: NewAlertRule) => void;
  removeRule: (id: string) => void;
  toggleRule: (id: string) => void;
}

export const useAlertsStore = create<AlertsState>()(
  persist(
    (set) => ({
      rules: [],
      addRule: (rule) =>
        set((s) => ({ rules: [...s.rules, { ...rule, id: crypto.randomUUID() } as AlertRule] })),
      removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      toggleRule: (id) =>
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
        })),
    }),
    { name: 'dashboard-alerts', version: 1 },
  ),
);

const fmtNum = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** One-line human summary — used by the settings rows, palette actions, and
 *  as the toast/notification title when the rule fires. */
export function describeRule(rule: AlertRule): string {
  switch (rule.kind) {
    case 'stock-price':
      return `${rule.symbol} ${rule.dir} $${fmtNum(rule.threshold)}`;
    case 'crypto-price':
      return `${rule.coinId} ${rule.dir} $${fmtNum(rule.thresholdUsd)}`;
    case 'crypto-change':
      return `${rule.coinId} moves ±${fmtNum(rule.magnitudePct)}% in 24h`;
    case 'cpu-sustained':
      return `CPU >${fmtNum(rule.thresholdPct)}% for ${rule.minutes}min`;
  }
}
