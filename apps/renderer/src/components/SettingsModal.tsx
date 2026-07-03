import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Check, Loader2, Lock, Minus, Plus, Download, Upload } from 'lucide-react';
import { CREDENTIAL_DEFS, CREDENTIAL_KEYS } from '@dash/shared';
import type { CredentialKey } from '@dash/shared';
import { useAppSettingsStore } from '../store/settingsStore';
import type { Density } from '../store/settingsStore';
import { exportSettings, importSettings } from '../lib/backup';
import { cn } from '../lib/utils';

// Group defs by service
const SERVICES = Array.from(new Set(CREDENTIAL_DEFS.map((d) => d.service)));

// ── Single credential row ─────────────────────────────────────────────────────

function CredentialRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="text-th-3 text-[11px] w-28 shrink-0">{label}</span>
        <div className="flex-1 flex items-center gap-1.5">
          <input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            spellCheck={false}
            className="flex-1 bg-th-elevated border border-th-line rounded-lg px-3 py-1.5 text-th-hi text-[11px] font-mono placeholder:text-th-ghost focus:outline-none focus:border-th-3 transition-colors"
          />
          <button
            onClick={() => setVisible((v) => !v)}
            className="text-th-ghost hover:text-th-2 transition-colors shrink-0 p-1"
            tabIndex={-1}
            title={visible ? 'Hide' : 'Show'}
          >
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>
      {hint && (
        <p className="text-th-ghost text-[10px] leading-relaxed pl-[calc(7rem+0.75rem)]">{hint}</p>
      )}
    </div>
  );
}

function BuiltinRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-th-3 text-[11px] w-28 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 text-th-ghost text-[11px]">
        <Lock size={11} className="shrink-0" />
        <span>Pre-configured</span>
      </div>
    </div>
  );
}

// ── Toggle switch row ─────────────────────────────────────────────────────────

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5',
          checked ? 'bg-th-accent' : 'bg-th-overlay',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <div className="flex flex-col">
        <span className="text-th-hi text-[11px]">{label}</span>
        {description && (
          <span className="text-th-ghost text-[10px] leading-relaxed">{description}</span>
        )}
      </div>
    </div>
  );
}

// ── App settings tab ──────────────────────────────────────────────────────────

const SCALE_MIN = 0.8;
const SCALE_MAX = 1.4;
const clampScale = (n: number) => Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) * 10) / 10;

function AppSettingsPanel() {
  const {
    weatherZip, showTempInClock, uiScale, density, compactTitlebar,
    setWeatherZip, setShowTempInClock, setUiScale, setDensity, setCompactTitlebar,
  } = useAppSettingsStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same filename
    if (!file) return;
    try {
      await importSettings(file);
      window.location.reload();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Import failed');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Weather */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Weather</span>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <span className="text-th-3 text-[11px] w-28 shrink-0">Location (ZIP)</span>
            <input
              value={weatherZip}
              onChange={(e) => setWeatherZip(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
              placeholder="Auto (by IP)"
              inputMode="numeric"
              maxLength={5}
              spellCheck={false}
              className="flex-1 bg-th-elevated border border-th-line rounded-lg px-3 py-1.5 text-th-hi text-[11px] font-mono placeholder:text-th-ghost focus:outline-none focus:border-th-3 transition-colors"
            />
          </div>
          <p className="text-th-ghost text-[10px] leading-relaxed pl-[calc(7rem+0.75rem)]">
            5-digit US ZIP to override your location. Leave blank to detect automatically.
          </p>
        </div>
      </div>

      {/* Top bar */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Top bar</span>
        <ToggleRow
          label="Show temperature"
          description="Display the current temperature next to the clock."
          checked={showTempInClock}
          onChange={setShowTempInClock}
        />
        <ToggleRow
          label="Compact titlebar"
          description="Always use icon-only menus and a pinned-layouts dropdown. Off = compact only on narrow windows."
          checked={compactTitlebar}
          onChange={setCompactTitlebar}
        />
      </div>

      {/* Display */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Display</span>

        <div className="flex items-center gap-3">
          <span className="text-th-3 text-[11px] w-28 shrink-0">UI scale</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUiScale(clampScale(uiScale - 0.1))}
              disabled={uiScale <= SCALE_MIN}
              className="w-6 h-6 rounded bg-th-elevated hover:bg-th-overlay text-th-hi disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              title="Smaller"
            >
              <Minus size={12} />
            </button>
            <span className="text-th-hi text-[11px] tabular-nums w-10 text-center">{Math.round(uiScale * 100)}%</span>
            <button
              onClick={() => setUiScale(clampScale(uiScale + 0.1))}
              disabled={uiScale >= SCALE_MAX}
              className="w-6 h-6 rounded bg-th-elevated hover:bg-th-overlay text-th-hi disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              title="Larger"
            >
              <Plus size={12} />
            </button>
            {uiScale !== 1 && (
              <button onClick={() => setUiScale(1)} className="ml-1 text-th-ghost hover:text-th-2 text-[10px] transition-colors">
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-th-3 text-[11px] w-28 shrink-0">Density</span>
          <div className="flex rounded-lg bg-th-elevated p-0.5">
            {(['comfortable', 'compact'] as Density[]).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={cn(
                  'px-2.5 py-1 rounded text-[10px] capitalize transition-colors',
                  density === d ? 'bg-th-overlay text-th-hi' : 'text-th-ghost hover:text-th-2',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Backup */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Backup</span>
        <div className="flex items-center gap-2">
          <button
            onClick={exportSettings}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
          >
            <Download size={13} /> Export
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
          >
            <Upload size={13} /> Import
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} className="hidden" />
        </div>
        <p className="text-th-ghost text-[10px] leading-relaxed">
          Layout, theme &amp; preferences (not API keys). Import replaces local settings and reloads — handy for syncing two machines.
        </p>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Tab = 'app' | 'dev';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('app');
  const [values, setValues] = useState<Partial<Record<CredentialKey, string>>>(
    () => Object.fromEntries(CREDENTIAL_KEYS.map((k) => [k, ''])) as Record<CredentialKey, string>,
  );
  const [builtinKeys, setBuiltinKeys] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!window.electron) { setLoading(false); return; } // defensive: no bridge outside Electron
    Promise.all([
      window.electron.credentials.getAll(),
      fetch('http://localhost:7432/api/credentials/builtin').then((r) => r.json() as Promise<{ keys: string[] }>),
    ]).then(([stored, builtin]) => {
      setValues((prev) => ({ ...prev, ...stored }));
      setBuiltinKeys(builtin.keys);
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleSave() {
    setSaveState('saving');
    try {
      await window.electron.credentials.saveAll(values);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }

  function setValue(key: CredentialKey, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    if (saveState !== 'idle') setSaveState('idle');
  }

  const tabBtn = (t: Tab, text: string) => (
    <button
      onClick={() => setTab(t)}
      className={cn(
        'px-3 py-1.5 text-[11px] font-medium border-b-2 -mb-px transition-colors',
        tab === t
          ? 'border-th-accent text-th-hi'
          : 'border-transparent text-th-ghost hover:text-th-2',
      )}
    >
      {text}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-th-surface border border-th-line rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-th-line shrink-0">
          <span className="text-th-hi font-semibold text-sm">Settings</span>
          <button
            onClick={onClose}
            className="text-th-ghost hover:text-th-hi transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-5 border-b border-th-line shrink-0">
          {tabBtn('app', 'App')}
          {tabBtn('dev', 'Developer')}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
          {tab === 'app' ? (
            <AppSettingsPanel />
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="text-th-ghost animate-spin" />
            </div>
          ) : (
            <>
              {SERVICES.map((service) => {
                const defs = CREDENTIAL_DEFS.filter((d) => d.service === service);
                return (
                  <div key={service} className="flex flex-col gap-3">
                    <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">
                      {service}
                    </span>
                    {defs.map((def) =>
                      builtinKeys.includes(def.key) ? (
                        <BuiltinRow key={def.key} label={def.label} />
                      ) : (
                        <CredentialRow
                          key={def.key}
                          label={def.label}
                          hint={def.hint}
                          value={values[def.key] ?? ''}
                          onChange={(v) => setValue(def.key, v)}
                        />
                      )
                    )}
                  </div>
                );
              })}

              {/* Info note */}
              <p className="text-th-ghost text-[10px] leading-relaxed border-t border-th-line pt-4">
                Spotify uses sign-in — no key needed. Weather, Hardware, and Sound require no API keys.
                <br />
                Keys are encrypted with your OS keychain and never leave this device.
              </p>
            </>
          )}
        </div>

        {/* Footer — only the Developer tab has a Save button (App settings auto-persist) */}
        {tab === 'dev' && (
          <div className="px-5 py-3 border-t border-th-line shrink-0 flex items-center justify-between">
            {saveState === 'error' && (
              <span className="text-red-400 text-[11px]">Failed to save — check console</span>
            )}
            {saveState !== 'error' && <span />}

            <button
              onClick={handleSave}
              disabled={saveState === 'saving' || loading}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
                saveState === 'saved'
                  ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                  : 'bg-th-overlay hover:bg-th-overlay/70 text-th-hi disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {saveState === 'saving' && <Loader2 size={12} className="animate-spin" />}
              {saveState === 'saved'  && <Check size={12} />}
              {saveState === 'saving' ? 'Saving…'
                : saveState === 'saved' ? 'Saved'
                : 'Save'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
