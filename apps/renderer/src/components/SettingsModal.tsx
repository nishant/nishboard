import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Check, Loader2, Lock, Minus, Plus, Download, Upload } from 'lucide-react';
import { CREDENTIAL_DEFS, CREDENTIAL_KEYS } from '@dash/shared';
import type { CredentialKey } from '@dash/shared';
import { useAppSettingsStore } from '../store/settingsStore';
import type { Density, TempUnit, WindUnit } from '../store/settingsStore';
import { useQueryClient } from '@tanstack/react-query';
import { exportSettings, importSettings } from '../lib/backup';
import { apiClient } from '../lib/apiClient';
import { cn } from '../lib/utils';

// Group defs by service
const SERVICES = Array.from(new Set(CREDENTIAL_DEFS.map((d) => d.service)));

// ── Single credential row (write-only) ────────────────────────────────────────
// Stored values never reach the renderer — a set key renders masked with
// Replace/Clear; only newly typed values live in state.

/** Pending change for one key: absent = untouched. */
type CredentialEdit = { mode: 'set'; value: string } | { mode: 'clear' };

function CredentialRow({
  label,
  hint,
  isSet,
  edit,
  onEdit,
}: {
  label: string;
  hint?: string;
  /** A value is stored in the main process. */
  isSet: boolean;
  edit: CredentialEdit | undefined;
  onEdit: (e: CredentialEdit | undefined) => void;
}) {
  const [visible, setVisible] = useState(false);

  const showInput = !isSet || edit?.mode === 'set';
  const pendingClear = isSet && edit?.mode === 'clear';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="text-th-3 text-[11px] w-28 shrink-0">{label}</span>

        {showInput ? (
          <div className="flex-1 flex items-center gap-1.5">
            <input
              type={visible ? 'text' : 'password'}
              value={edit?.mode === 'set' ? edit.value : ''}
              onChange={(e) => {
                const v = e.target.value;
                // Emptied input on an unset key = untouched again
                onEdit(v === '' && !isSet ? undefined : { mode: 'set', value: v });
              }}
              placeholder={isSet ? 'New value…' : '—'}
              autoFocus={isSet}
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
            {isSet && (
              <button
                onClick={() => onEdit(undefined)}
                className="text-th-ghost hover:text-th-2 transition-colors shrink-0 p-1"
                title="Keep the saved value"
              >
                <X size={13} />
              </button>
            )}
          </div>
        ) : pendingClear ? (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-amber-400 text-[11px]">Will be removed on save</span>
            <button
              onClick={() => onEdit(undefined)}
              className="text-th-ghost hover:text-th-2 text-[10px] underline transition-colors"
            >
              Undo
            </button>
          </div>
        ) : (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-th-hi text-[11px] font-mono tracking-widest">••••••••</span>
            <span className="text-th-ghost text-[10px]">saved</span>
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => onEdit({ mode: 'set', value: '' })}
                className="px-2 py-0.5 rounded text-[10px] text-th-2 bg-th-elevated hover:bg-th-overlay transition-colors"
              >
                Replace
              </button>
              <button
                onClick={() => onEdit({ mode: 'clear' })}
                className="px-2 py-0.5 rounded text-[10px] text-th-ghost hover:text-red-400 bg-th-elevated transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}
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

// ── Segmented picker row ──────────────────────────────────────────────────────

function SegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-th-3 text-[11px] w-28 shrink-0">{label}</span>
      <div className="flex rounded-lg bg-th-elevated p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'px-2.5 py-1 rounded text-[10px] transition-colors',
              value === o.value ? 'bg-th-overlay text-th-hi' : 'text-th-ghost hover:text-th-2',
            )}
          >
            {o.label}
          </button>
        ))}
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
    tempUnit, windUnit, clock24h,
    setWeatherZip, setShowTempInClock, setUiScale, setDensity, setCompactTitlebar,
    setTempUnit, setWindUnit, setClock24h,
  } = useAppSettingsStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [importError, setImportError] = useState<string | null>(null);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same filename
    if (!file) return;
    try {
      await importSettings(file);
      window.location.reload();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
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

      {/* Units & time */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Units &amp; time</span>
        <SegmentedRow<TempUnit>
          label="Temperature"
          value={tempUnit}
          options={[{ value: 'f', label: '°F' }, { value: 'c', label: '°C' }]}
          onChange={setTempUnit}
        />
        <SegmentedRow<WindUnit>
          label="Wind speed"
          value={windUnit}
          options={[{ value: 'mph', label: 'mph' }, { value: 'kmh', label: 'km/h' }]}
          onChange={setWindUnit}
        />
        <ToggleRow
          label="24-hour clock"
          description="Applies to the titlebar clock, world clock, alarms and countdowns."
          checked={clock24h}
          onChange={setClock24h}
        />
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

        <SegmentedRow<Density>
          label="Density"
          value={density}
          options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
          onChange={setDensity}
        />
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
        {importError && (
          <p className="text-red-400 text-[10px] leading-relaxed">{importError}</p>
        )}
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
  // Which keys have a stored value (booleans only — values never come over).
  const [status, setStatus] = useState<Partial<Record<CredentialKey, boolean>>>({});
  // Pending changes keyed by credential; absent = untouched.
  const [edits, setEdits] = useState<Partial<Record<CredentialKey, CredentialEdit>>>({});
  const [builtinKeys, setBuiltinKeys] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loading, setLoading] = useState(true);
  const [encryptionAvailable, setEncryptionAvailable] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const electron = window.electron;
    if (!electron) { setLoading(false); return; } // defensive: no bridge outside Electron
    let cancelled = false; // don't setState after Escape unmounts the modal mid-load
    Promise.all([
      electron.credentials.getStatus(),
      apiClient.get<{ keys: string[] }>('/api/credentials/builtin'),
      electron.credentials.encryptionAvailable().catch(() => true),
    ]).then(([storedStatus, builtin, encAvailable]) => {
      if (cancelled) return;
      setStatus(storedStatus);
      setBuiltinKeys(builtin.keys);
      setEncryptionAvailable(encAvailable);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Payload for saveAll: non-empty string = set/replace, '' = clear, absent = keep.
  // Replace-mode rows with nothing typed yet are skipped (nothing to save).
  const payload: Partial<Record<CredentialKey, string>> = {};
  for (const key of CREDENTIAL_KEYS) {
    const edit = edits[key];
    if (!edit) continue;
    if (edit.mode === 'clear') payload[key] = '';
    else if (edit.value.trim() !== '') payload[key] = edit.value.trim();
  }
  const hasChanges = Object.keys(payload).length > 0;

  async function handleSave() {
    if (!window.electron || !hasChanges) return;
    setSaveState('saving');
    try {
      // Resolves only after the Fastify child has restarted with the new env.
      await window.electron.credentials.saveAll(payload);
      // Reflect the merge locally: set keys become "saved", cleared ones unset.
      setStatus((prev) => {
        const next = { ...prev };
        for (const [key, val] of Object.entries(payload)) {
          next[key as CredentialKey] = val !== '';
        }
        return next;
      });
      setEdits({});
      // Widgets were getting connection-refused during the restart — refetch
      // everything now instead of leaving them in error until their next poll.
      await queryClient.invalidateQueries();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }

  function setEdit(key: CredentialKey, edit: CredentialEdit | undefined) {
    setEdits((prev) => {
      const next = { ...prev };
      if (edit === undefined) delete next[key];
      else next[key] = edit;
      return next;
    });
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
                          isSet={status[def.key] === true}
                          edit={edits[def.key]}
                          onEdit={(e) => setEdit(def.key, e)}
                        />
                      )
                    )}
                  </div>
                );
              })}

              {/* Info note */}
              {!encryptionAvailable && (
                <p className="text-amber-400 text-[10px] leading-relaxed border-t border-th-line pt-4">
                  OS keychain unavailable — keys will be stored unencrypted on this device's disk.
                </p>
              )}
              <p className={cn(
                'text-th-ghost text-[10px] leading-relaxed',
                encryptionAvailable && 'border-t border-th-line pt-4',
              )}>
                Spotify uses sign-in — no key needed. Weather, Hardware, and Sound require no API keys.
                <br />
                {encryptionAvailable
                  ? 'Keys are encrypted with your OS keychain and are write-only: they can be replaced or cleared here, never viewed.'
                  : 'Keys are write-only: they can be replaced or cleared here, never viewed.'}
              </p>
            </>
          )}
        </div>

        {/* Footer — only the Developer tab has a Save button (App settings auto-persist) */}
        {tab === 'dev' && (
          <div className="px-5 py-3 border-t border-th-line shrink-0 flex items-center justify-between">
            {saveState === 'error' && (
              <span className="text-red-400 text-[11px]">Failed to save — the server didn't restart cleanly. Try again.</span>
            )}
            {saveState === 'saving' && (
              <span className="text-th-ghost text-[11px]">Restarting server with new keys…</span>
            )}
            {saveState !== 'error' && saveState !== 'saving' && <span />}

            <button
              onClick={handleSave}
              disabled={saveState === 'saving' || loading || !hasChanges}
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
