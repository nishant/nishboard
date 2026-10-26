import { useState } from 'react';
import { Plus, X, BellOff } from 'lucide-react';
import { useAlertsStore, describeRule, DEFAULT_COOLDOWN_MIN } from '../../store/alertsStore';
import type { AlertRule, AlertRuleKind, NewAlertRule } from '../../store/alertsStore';
import { useStocksStore } from '../../store/stocksStore';
import { useCryptoStore } from '../../store/cryptoStore';
import { Button, EmptyState, Field, IconButton, Segmented, Switch, cn } from '@nish/ui';
import { Input, Select } from '../nishGaps';

const KIND_LABELS: Record<AlertRuleKind, string> = {
  'stock-price': 'Stock price',
  'crypto-price': 'Crypto price',
  'crypto-change': 'Crypto 24h move',
  'cpu-sustained': 'CPU sustained',
};

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
  const stockWatchlist = useStocksStore((s) => s.watchlist);
  // A stock rule whose ticker left the watchlist never evaluates (the stocks
  // query only fetches watchlist symbols) — surface that instead of guessing.
  const stranded =
    rule.kind === 'stock-price' && !stockWatchlist.includes(rule.symbol.toUpperCase());

  return (
    <div className="flex items-center gap-2.5 group">
      <Switch size="sm" checked={rule.enabled} onChange={() => toggleRule(rule.id)} aria-label={`Enable: ${describeRule(rule)}`} />
      <div className="flex flex-col min-w-0 flex-1">
        <span className={cn('text-2xs truncate', rule.enabled ? 'text-th-hi' : 'text-th-hi3')}>
          {describeRule(rule)}
        </span>
        <span className="text-th-hi3 text-3xs">
          {stranded ? (
            <span className="text-th-warn">not in watchlist — won't fire</span>
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
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      >
        <X size={13} />
      </IconButton>
    </div>
  );
}

export function AlertsPanel() {
  const rules = useAlertsStore((s) => s.rules);
  const addRule = useAlertsStore((s) => s.addRule);
  const stockWatchlist = useStocksStore((s) => s.watchlist);
  const addTicker = useStocksStore((s) => s.addTicker);
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

  const cooldownMin = Math.max(1, Number(cooldown) || DEFAULT_COOLDOWN_MIN);

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
        if (!coinId || !(n > 0)) return null;
        return { ...base, kind, coinId, dir, thresholdUsd: n };
      }
      case 'crypto-change': {
        const n = Number(magnitude);
        if (!coinId || !(n > 0)) return null;
        return { ...base, kind, coinId, magnitudePct: n };
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
    // A rule for an off-watchlist ticker would silently never evaluate — the
    // stocks query only fetches watchlist symbols. Adding it is the fix.
    if (draft.kind === 'stock-price') addTicker(draft.symbol);
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
          <Select size="sm" value={kind} onChange={(e) => setKind(e.target.value as AlertRuleKind)}>
            {(Object.keys(KIND_LABELS) as AlertRuleKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </Select>
        </Field>

        {kind === 'stock-price' && (
          <div className="flex items-center gap-3">
            <span className="text-th-hi3 text-2xs w-28 shrink-0">Condition</span>
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
          <div className="flex items-center gap-3">
            <span className="text-th-hi3 text-2xs w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <Select size="sm" value={coinId} onChange={(e) => setCoinId(e.target.value)} aria-label="Coin" className="w-28">
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
          <div className="flex items-center gap-3">
            <span className="text-th-hi3 text-2xs w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <NumField value={cpuPct} onChange={setCpuPct} placeholder="90" suffix="%" label="CPU percent" width="w-16" />
              <span className="text-th-hi3 text-3xs">for</span>
              <NumField value={minutes} onChange={setMinutes} placeholder="5" suffix="min" label="Minutes sustained" width="w-16" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="text-th-hi3 text-2xs w-28 shrink-0">Cooldown</span>
          <NumField value={cooldown} onChange={setCooldown} placeholder="30" suffix="min between fires" label="Cooldown in minutes" width="w-16" />
        </div>

        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0" />
          <Button size="sm" variant="subtle" icon={<Plus size={13} />} onClick={submit} disabled={!draft}>
            Add alert
          </Button>
        </div>

        <p className="text-th-hi3 text-3xs leading-relaxed">
          Alerts chime, toast, and send a native notification. They're edge-triggered — a rule
          fires when its condition becomes true, then re-arms once it's false again. Adding a
          stock alert also adds the ticker to the Stocks watchlist (rules only evaluate
          watched symbols). CPU rules note: the sustained timer restarts if monitoring is
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
