import { useEffect } from 'react';
import { useAlertsStore } from '../store/alertsStore';
import {
  evaluateCpuRules,
  evaluateCryptoRules,
  evaluateStockRules,
  pruneTriggerStates,
} from '../lib/alertEval';
import { useAlertGatedInterval } from '../hooks/useGatedInterval';
import { useStocks } from '../widgets/stocks/useStocks';
import { useCrypto } from '../widgets/crypto/useCrypto';
import { useHardwareQuery } from '../widgets/hardware/useHardware';

/**
 * Headless rule evaluator, mounted once in App. Observes the SAME queries the
 * widgets use (identical keys → TanStack dedupes the fetches); each observer
 * is enabled only while a rule of its kind exists, so zero rules of a kind
 * forces zero polling. Unlike the widgets, its intervals stay alive while the
 * window is hidden (×4 slowdown) — alerts are for when you're not looking.
 */
export function AlertsEvaluator() {
  const rules = useAlertsStore((s) => s.rules);

  const needStocks = rules.some((r) => r.enabled && r.kind === 'stock-price');
  const needCrypto = rules.some(
    (r) => r.enabled && (r.kind === 'crypto-price' || r.kind === 'crypto-change'),
  );
  const needCpu = rules.some((r) => r.enabled && r.kind === 'cpu-sustained');

  const stocksInterval = useAlertGatedInterval(5 * 60 * 1000);
  const cryptoInterval = useAlertGatedInterval(5 * 60 * 1000);
  const cpuInterval = useAlertGatedInterval(1000);

  const stocks = useStocks(needStocks, needStocks ? stocksInterval : false);
  const crypto = useCrypto(needCrypto, needCrypto ? cryptoInterval : false);
  const hardware = useHardwareQuery(needCpu, needCpu ? cpuInterval : false);

  useEffect(() => {
    pruneTriggerStates(new Set(rules.filter((r) => r.enabled).map((r) => r.id)));
  }, [rules]);

  useEffect(() => {
    if (stocks.data) evaluateStockRules(rules, stocks.data, Date.now());
  }, [stocks.data, rules]);

  useEffect(() => {
    if (crypto.data) evaluateCryptoRules(rules, crypto.data, Date.now());
  }, [crypto.data, rules]);

  useEffect(() => {
    if (hardware.data) evaluateCpuRules(rules, hardware.data, Date.now());
  }, [hardware.data, rules]);

  return null;
}
