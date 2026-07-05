import { useState } from 'react';
import { Plus, X, BellOff } from 'lucide-react';
import { useAlertsStore, describeRule, DEFAULT_COOLDOWN_MIN } from '../../store/alertsStore';
import type { AlertRule, AlertRuleKind, NewAlertRule } from '../../store/alertsStore';
import { useStocksStore } from '../../store/stocksStore';
import { useCryptoStore } from '../../store/cryptoStore';
import { cn } from '../../lib/utils';

const KIND_LABELS: Record<AlertRuleKind, string> = {
  'stock-price': 'Stock price',
  'crypto-price': 'Crypto price',
  'crypto-change': 'Crypto 24h move',
  'cpu-sustained': 'CPU sustained',
};

const inputCls =
  'bg-th-elevated border border-th-line rounded-lg px-2.5 py-1.5 text-th-hi text-[11px] placeholder:text-th-ghost focus:outline-none focus:border-th-3 transition-colors';

function NumField({
  value, onChange, placeholder, suffix, width = 'w-24',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  suffix?: string;
  width?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder={placeholder}
        inputMode="decimal"
        className={cn(inputCls, width, 'font-mono')}
      />
      {suffix && <span className="text-th-ghost text-[10px]">{suffix}</span>}
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
      <button
        role="switch"
        aria-checked={rule.enabled}
        onClick={() => toggleRule(rule.id)}
        className={cn(
          'relative w-7 h-4 rounded-full transition-colors shrink-0',
          rule.enabled ? 'bg-th-accent' : 'bg-th-overlay',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform',
            rule.enabled && 'translate-x-3',
          )}
        />
      </button>
      <div className="flex flex-col min-w-0 flex-1">
        <span className={cn('text-[11px] truncate', rule.enabled ? 'text-th-hi' : 'text-th-ghost')}>
          {describeRule(rule)}
        </span>
        <span className="text-th-ghost text-[10px]">
          {stranded ? (
            <span className="text-amber-400">not in watchlist — won't fire</span>
          ) : (
            `cooldown ${rule.cooldownMin}min`
          )}
        </span>
      </div>
      <button
        onClick={() => removeRule(rule.id)}
        className="text-th-ghost hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0 p-1"
        title="Delete rule"
      >
        <X size={13} />
      </button>
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
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Rules</span>
        {rules.length === 0 ? (
          <div className="flex items-center gap-2 text-th-ghost text-[11px]">
            <BellOff size={13} />
            <span>No alert rules yet — add one below.</span>
          </div>
        ) : (
          rules.map((r) => <RuleRow key={r.id} rule={r} />)
        )}
      </div>

      {/* Add rule */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Add rule</span>

        <div className="flex items-center gap-3">
          <span className="text-th-3 text-[11px] w-28 shrink-0">Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AlertRuleKind)}
            className={cn(inputCls, 'flex-1')}
          >
            {(Object.keys(KIND_LABELS) as AlertRuleKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>

        {kind === 'stock-price' && (
          <div className="flex items-center gap-3">
            <span className="text-th-3 text-[11px] w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z.]/g, ''))}
                placeholder="AAPL"
                list="alert-stock-symbols"
                spellCheck={false}
                className={cn(inputCls, 'w-24 font-mono')}
              />
              <datalist id="alert-stock-symbols">
                {stockWatchlist.map((t) => <option key={t} value={t} />)}
              </datalist>
              <DirPicker dir={dir} setDir={setDir} />
              <NumField value={threshold} onChange={setThreshold} placeholder="250" suffix="USD" />
            </div>
          </div>
        )}

        {(kind === 'crypto-price' || kind === 'crypto-change') && (
          <div className="flex items-center gap-3">
            <span className="text-th-3 text-[11px] w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={coinId} onChange={(e) => setCoinId(e.target.value)} className={cn(inputCls, 'w-28')}>
                {cryptoWatchlist.length === 0 && <option value="">— no coins —</option>}
                {cryptoWatchlist.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {kind === 'crypto-price' ? (
                <>
                  <DirPicker dir={dir} setDir={setDir} />
                  <NumField value={threshold} onChange={setThreshold} placeholder="120000" suffix="USD" />
                </>
              ) : (
                <NumField value={magnitude} onChange={setMagnitude} placeholder="5" suffix="% in 24h" width="w-16" />
              )}
            </div>
          </div>
        )}

        {kind === 'cpu-sustained' && (
          <div className="flex items-center gap-3">
            <span className="text-th-3 text-[11px] w-28 shrink-0">Condition</span>
            <div className="flex items-center gap-2 flex-wrap">
              <NumField value={cpuPct} onChange={setCpuPct} placeholder="90" suffix="%" width="w-16" />
              <span className="text-th-ghost text-[10px]">for</span>
              <NumField value={minutes} onChange={setMinutes} placeholder="5" suffix="min" width="w-16" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="text-th-3 text-[11px] w-28 shrink-0">Cooldown</span>
          <NumField value={cooldown} onChange={setCooldown} placeholder="30" suffix="min between fires" width="w-16" />
        </div>

        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0" />
          <button
            onClick={submit}
            disabled={!draft}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={13} /> Add alert
          </button>
        </div>

        <p className="text-th-ghost text-[10px] leading-relaxed">
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
    <div className="flex rounded-lg bg-th-elevated p-0.5">
      {(['above', 'below'] as const).map((d) => (
        <button
          key={d}
          onClick={() => setDir(d)}
          className={cn(
            'px-2.5 py-1 rounded text-[10px] transition-colors',
            dir === d ? 'bg-th-overlay text-th-hi' : 'text-th-ghost hover:text-th-2',
          )}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
