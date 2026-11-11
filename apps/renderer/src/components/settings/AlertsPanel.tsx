import { useState } from 'react';
import { Plus, X, BellOff } from 'lucide-react';
import { useAlertsStore, describeRule, DEFAULT_COOLDOWN_MIN } from '../../store/alertsStore';
import type { AlertRule, AlertRuleKind, NewAlertRule } from '../../store/alertsStore';
import { useWatchlistTickers } from '../../widgets/stocks/useStocks';
import { useCryptoStore } from '../../store/cryptoStore';
import { Button, EmptyState, Field, IconButton, Segmented, Switch, cn, Input, Select } from '@nish/ui';

const KIND_LABELS: Record<AlertRuleKind, string> = {
  'stock-price': 'Stock price',
  'crypto-price': 'Crypto price',
  'crypto-change': 'Crypto 24h move',
  'cpu-sustained': 'CPU sustained',
};
const KINDS: AlertRuleKind[] = ['stock-price', 'crypto-price', 'crypto-change', 'cpu-sustained'];

function isAlertRuleKind(v: string): v is AlertRuleKind {
  return KINDS.some((k) => k === v);
}

function NumField({
  value, onChange, placeholder, suffix, label, width = 'w-24',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  suffix?: string;
  /** Accessible name (the row label alone is ambiguous when a row has two fields). */
  label: string;
  width?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        size="sm"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={placeholder}
        inputMode="decimal"
        aria-label={label}
        className={cn(width, 'font-mono')}
      />
      {suffix && <span className="text-th-hi3 text-3xs" aria-hidden="true">{suffix}</span>}
    </div>
  );
}

function RuleRow({ rule }: { rule: AlertRule }) {
  const { toggleRule, removeRule } = useAlertsStore();
  const stockWatchlist = useWatchlistTickers(rule.kind === 'stock-price');
  // A stock rule whose ticker isn't on trading's watchlist never evaluates
  // (the stocks query only fetches watchlist symbols) — surface that instead
  // of guessing. Skipped while the watchlist is unknown (loading/disconnected).
  const stranded =
    rule.kind === 'stock-price' && stockWatchlist.length > 0 && !stockWatchlist.includes(rule.symbol.toUpperCase());

  return (
    <div className="flex items-center gap-2.5 group">
      <Switch size="sm" checked={rule.enabled} onCheckedChange={() => toggleRule(rule.id)} aria-label={`Enable: ${describeRule(rule)}`} />
      <div className="flex flex-col min-w-0 flex-1">
        <span className={cn('text-2xs truncate', rule.enabled ? 'text-th-hi' : 'text-th-hi3')}>
          {describeRule(rule)}
        </span>
        <span className="text-th-hi3 text-3xs">
          {stranded ? (
            <span className="text-th-warn">not on trading's watchlist — won't fire</span>
          ) : (
            `cooldown ${rule.cooldownMin}min`
          )}
        </span>
      </div>
      <IconButton
        label="Delete rule"
        size="sm"
        tone="danger"
        onClick={() => removeRule(rule.id)}
        className="min-h-11 min-w-11 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 focus-visible:opacity-100"
      >
        <X size={13} />
      </IconButton>
    </div>
  );
}

export function AlertsPanel() {
  const rules = useAlertsStore((s) => s.rules);
  const addRule = useAlertsStore((s) => s.addRule);
  const stockWatchlist = useWatchlistTickers();
  const cryptoWatchlist = useCryptoStore((s) => s.watchlist);

  const [kind, setKind] = useState<AlertRuleKind>('stock-price');
  const [symbol, setSymbol] = useState('');
  const [coinId, setCoinId] = useState(cryptoWatchlist[0] ?? '');
  const [dir, setDir] = useState<'above' | 'below'>('above');
  const [threshold, setThreshold] = useState('');
  const [magnitude, setMagnitude] = useState('5');
  const [cpuPct, setCpuPct] = useState('90');
  const [minutes, setMinutes] = useState('5');
  const [cooldown, setCooldown] = useState(String(DEFAULT_COOLDOWN_MIN));

  const cooldownNum = Number(cooldown);
  const cooldownMin = cooldown !== '' && Number.isFinite(cooldownNum) ? Math.max(1, Math.round(cooldownNum)) : DEFAULT_COOLDOWN_MIN;
  // The select shows the first coin when the chosen one left the watchlist (or
  // the watchlist was empty at mount), so the rule must use what is shown.
  const effectiveCoinId = cryptoWatchlist.includes(coinId) ? coinId : cryptoWatchlist[0] ?? '';

  function buildRule(): NewAlertRule | null {
    const base = { enabled: true, cooldownMin };
    switch (kind) {
      case 'stock-price': {
        const sym = symbol.trim().toUpperCase();
        const n = Number(threshold);
        if (!/^[A-Z.]{1,10}$/.test(sym) || !(n > 0)) return null;
        return { ...base, kind, symbol: sym, dir, threshold: n };
      }
      case 'crypto-price': {
        const n = Number(threshold);
        if (!effectiveCoinId || !(n > 0)) return null;
        return { ...base, kind, coinId: effectiveCoinId, dir, thresholdUsd: n };
      }
      case 'crypto-change': {
        const n = Number(magnitude);
        if (!effectiveCoinId || !(n > 0)) return null;
        return { ...base, kind, coinId: effectiveCoinId, magnitudePct: n };
      }
      case 'cpu-sustained': {
        const pct = Number(cpuPct);
        const min = Number(minutes);
        if (!(pct > 0 && pct < 100) || !(min >= 1)) return null;
        return { ...base, kind, thresholdPct: pct, minutes: Math.round(min) };
      }
    }
  }

  const draft = buildRule();

  function submit() {
    if (!draft) return;
    addRule(draft);
    setSymbol('');
    setThreshold('');
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Existing rules */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Rules</span>
        {rules.length === 0 ? (
          <EmptyState compact icon={<BellOff size={13} />} title="No alert rules yet — add one below." className="items-start py-0" />
        ) : (
          rules.map((r) => <RuleRow key={r.id} rule={r} />)
        )}
      </div>

      {/* Add rule */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Add rule</span>

        <Field layout="inline" label="Type">
          <Select size="sm" value={kind} onChange={(e) => { if (isAlertRuleKind(e.target.value)) setKind(e.target.value); }}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </Select>
        </Field>

        {kind === 'stock-price' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-th-hi3 text-2xs sm:w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                size="sm"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z.]/g, ''))}
                placeholder="AAPL"
                list="alert-stock-symbols"
                spellCheck={false}
                aria-label="Ticker"
                className="w-24 font-mono"
              />
              <datalist id="alert-stock-symbols">
                {stockWatchlist.map((t) => <option key={t} value={t} />)}
              </datalist>
              <DirPicker dir={dir} setDir={setDir} />
              <NumField value={threshold} onChange={setThreshold} placeholder="250" suffix="USD" label="Price in USD" />
            </div>
          </div>
        )}

        {(kind === 'crypto-price' || kind === 'crypto-change') && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-th-hi3 text-2xs sm:w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <Select size="sm" value={effectiveCoinId} onChange={(e) => setCoinId(e.target.value)} aria-label="Coin" className="w-28">
                {cryptoWatchlist.length === 0 && <option value="">— no coins —</option>}
                {cryptoWatchlist.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              {kind === 'crypto-price' ? (
                <>
                  <DirPicker dir={dir} setDir={setDir} />
                  <NumField value={threshold} onChange={setThreshold} placeholder="120000" suffix="USD" label="Price in USD" />
                </>
              ) : (
                <NumField value={magnitude} onChange={setMagnitude} placeholder="5" suffix="% in 24h" label="Percent move in 24 hours" width="w-16" />
              )}
            </div>
          </div>
        )}

        {kind === 'cpu-sustained' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
            <span className="text-th-hi3 text-2xs sm:w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <NumField value={cpuPct} onChange={setCpuPct} placeholder="90" suffix="%" label="CPU percent" width="w-16" />
              <span className="text-th-hi3 text-3xs">for</span>
              <NumField value={minutes} onChange={setMinutes} placeholder="5" suffix="min" label="Minutes sustained" width="w-16" />
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
          <span className="text-th-hi3 text-2xs sm:w-28 shrink-0">Cooldown</span>
          <NumField value={cooldown} onChange={setCooldown} placeholder="30" suffix="min between fires" label="Cooldown in minutes" width="w-16" />
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:block w-28 shrink-0" />
          <Button size="sm" variant="subtle" icon={<Plus size={13} />} onClick={submit} disabled={!draft}>
            Add alert
          </Button>
        </div>

        <p className="text-th-hi3 text-3xs leading-relaxed">
          Alerts chime, toast, and send a native notification. They're edge-triggered — a rule
          fires when its condition becomes true, then re-arms once it's false again. Stock alerts
          only evaluate tickers on trading's watchlist (edit it in trading). CPU rules note: the sustained timer restarts if monitoring is
          interrupted (sleep, server restart).
        </p>
      </div>
    </div>
  );
}

function DirPicker({ dir, setDir }: { dir: 'above' | 'below'; setDir: (d: 'above' | 'below') => void }) {
  return (
    <Segmented<'above' | 'below'>
      label="Direction"
      size="xs"
      value={dir}
      onChange={setDir}
      options={[
        { value: 'above', label: 'above' },
        { value: 'below', label: 'below' },
      ]}
    />
  );
}
