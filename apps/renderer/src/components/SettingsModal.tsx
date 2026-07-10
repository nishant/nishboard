import { useState, useEffect, useRef } from 'react';
import { X, Eye, EyeOff, Check, Loader2, Lock, Minus, Plus, Download, Upload, FolderOpen, RotateCw, FolderSync } from 'lucide-react';
import { CREDENTIAL_DEFS, CREDENTIAL_KEYS } from '@dash/shared';
import type { CredentialKey, AppPrefsData, UpdateCheckData } from '@dash/shared';
import { useAppSettingsStore } from '../store/settingsStore';
import type { Density, TempUnit, WindUnit, LowPowerMode, WeatherAlertNotify } from '../store/settingsStore';
import { useQueryClient } from '@tanstack/react-query';
import { exportSettings, importSettings } from '../lib/backup';
import { apiClient } from '../lib/apiClient';
import { cn } from '../lib/utils';
import { ToggleRow, SegmentedRow } from './settings/controls';
import { AlertsPanel } from './settings/AlertsPanel';
import { useOverlayStore } from '../store/overlayStore';

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

// ── About + update check (Electron only) ──────────────────────────────────────

function AboutSection() {
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electron?.app?.getVersion().then((v) => { if (!cancelled) setVersion(v); });
    return () => { cancelled = true; };
  }, []);

  if (!window.electron?.app) return null;

  async function check() {
    setChecking(true);
    try {
      setResult(await window.electron!.app.checkUpdates());
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">About</span>
      <div className="flex items-center gap-3">
        <span className="text-th-3 text-[11px] w-28 shrink-0">Version</span>
        <span className="text-th-hi text-[11px] font-mono">{version ?? '…'}</span>
        <button
          onClick={() => void check()}
          disabled={checking}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] disabled:opacity-50 transition-colors"
        >
          {checking && <Loader2 size={12} className="animate-spin" />}
          Check for updates
        </button>
      </div>
      {result && (
        <div className="text-[10px] leading-relaxed pl-[calc(7rem+0.75rem)] flex flex-col gap-1">
          {result.hasUpdate && result.latestVersion ? (
            <>
              <button
                onClick={() => result.url && window.electron?.openExternal(result.url)}
                className="text-th-accent underline text-left"
              >
                v{result.latestVersion} is available — open release page
              </button>
              {result.assetUrl && (
                <button
                  onClick={() => window.electron?.openExternal(result.assetUrl!)}
                  className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
                  title={result.assetName ?? undefined}
                >
                  Download v{result.latestVersion} ({result.assetName?.endsWith('.dmg') ? 'DMG' : 'EXE'})
                </button>
              )}
            </>
          ) : (
            <span className="text-th-ghost">{result.message ?? 'You are up to date.'}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Auto-export to a synced folder (Electron only) ────────────────────────────

function AutoExportRow() {
  const [dir, setDir] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.electron?.prefs?.get().then((p) => {
      if (!cancelled) { setDir(p.backupDir); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, []);

  if (!window.electron?.backup || !loaded) return null;

  async function choose() {
    const chosen = await window.electron!.backup.chooseFolder();
    if (chosen) setDir(chosen);
  }
  async function disable() {
    await window.electron!.prefs.set({ backupDir: null });
    setDir(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => void choose()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
        >
          <FolderSync size={13} /> {dir ? 'Change folder' : 'Auto-export…'}
        </button>
        {dir && (
          <>
            <span className="text-th-3 text-[10px] font-mono truncate flex-1 min-w-0" title={dir}>{dir}</span>
            <button onClick={() => void disable()} className="text-th-ghost hover:text-red-400 text-[10px] underline shrink-0 transition-colors">
              Disable
            </button>
          </>
        )}
      </div>
      <p className="text-th-ghost text-[10px] leading-relaxed">
        {dir
          ? 'Settings auto-save to this folder on every change (2s debounce, atomic write).'
          : 'Pick a Google Drive / OneDrive / Dropbox folder to keep a continuously synced settings backup.'}
      </p>
    </div>
  );
}

// ── System prefs (main-side prefs.json via IPC — Electron only) ───────────────

function SystemPrefsSection() {
  const [prefs, setPrefs] = useState<AppPrefsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electron?.prefs?.get().then((p) => { if (!cancelled) setPrefs(p); });
    return () => { cancelled = true; };
  }, []);

  if (!window.electron?.prefs || !prefs) return null;

  async function update(patch: Partial<AppPrefsData>) {
    const next = await window.electron!.prefs.set(patch);
    setPrefs(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">System</span>
      <SegmentedRow<AppPrefsData['closeAction']>
        label="Close button"
        value={prefs.closeAction}
        options={[{ value: 'quit', label: 'Quit' }, { value: 'tray', label: 'Hide to tray' }]}
        onChange={(v) => void update({ closeAction: v })}
      />
      <ToggleRow
        label="Global show/hide hotkey"
        description="Ctrl+Shift+D (Cmd+Shift+D on macOS) toggles the dashboard from anywhere."
        checked={prefs.globalHotkey}
        onChange={(v) => void update({ globalHotkey: v })}
      />
      <p className="text-th-ghost text-[10px] leading-relaxed">
        The tray icon is always available: show/hide, Spotify play/pause, restart server, quit.
      </p>
    </div>
  );
}

// ── App settings tab ──────────────────────────────────────────────────────────

const SCALE_MIN = 0.8;
const SCALE_MAX = 1.4;
const clampScale = (n: number) => Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, n)) * 10) / 10;

function AppSettingsPanel() {
  const {
    weatherZips, showTempInClock, uiScale, density, compactTitlebar,
    tempUnit, windUnit, clock24h, lowPower, weatherAlertNotify, twitchLiveNotify, hideYoutubeShorts,
    youtubeSubsChannelsOnly, claudeAllowTools,
    setWeatherZips, setShowTempInClock, setUiScale, setDensity, setCompactTitlebar,
    setTempUnit, setWindUnit, setClock24h, setLowPower, setWeatherAlertNotify, setTwitchLiveNotify,
    setHideYoutubeShorts, setYoutubeSubsChannelsOnly, setClaudeAllowTools,
  } = useAppSettingsStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [importError, setImportError] = useState<string | null>(null);

  // Free-form text while typing; parsed into the store on blur/Enter so a
  // half-typed ZIP doesn't thrash the weather query.
  const [zipsText, setZipsText] = useState(() => weatherZips.join(', '));
  function commitZips() {
    const zips = [...new Set(
      zipsText.split(',').map((z) => z.trim()).filter((z) => /^\d{5}$/.test(z)),
    )];
    setWeatherZips(zips);
    setZipsText(zips.join(', '));
  }

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
            <span className="text-th-3 text-[11px] w-28 shrink-0">Locations (ZIP)</span>
            <input
              value={zipsText}
              onChange={(e) => setZipsText(e.target.value.replace(/[^0-9,\s]/g, ''))}
              onBlur={commitZips}
              onKeyDown={(e) => { if (e.key === 'Enter') commitZips(); }}
              placeholder="Auto (by IP)"
              inputMode="numeric"
              spellCheck={false}
              className="flex-1 bg-th-elevated border border-th-line rounded-lg px-3 py-1.5 text-th-hi text-[11px] font-mono placeholder:text-th-ghost focus:outline-none focus:border-th-3 transition-colors"
            />
          </div>
          <p className="text-th-ghost text-[10px] leading-relaxed pl-[calc(7rem+0.75rem)]">
            One or more 5-digit US ZIPs, comma-separated — the weather widget's ‹ › cycles
            between them. Leave blank to detect automatically.
          </p>
        </div>
        <SegmentedRow<WeatherAlertNotify>
          label="Alert push"
          value={weatherAlertNotify}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'severe', label: 'Severe only' },
            { value: 'all', label: 'All' },
          ]}
          onChange={setWeatherAlertNotify}
        />
        <p className="text-th-ghost text-[10px] leading-relaxed">
          New NWS weather alerts chime, toast, and send a native notification.
          Severe = Extreme/Severe alerts only.
        </p>
      </div>

      {/* Twitch */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Twitch</span>
        <ToggleRow
          label="Go-live alerts"
          description="Chime, toast, and native notification when a followed channel goes live. Needs a connected Twitch account (widget → Connect)."
          checked={twitchLiveNotify}
          onChange={setTwitchLiveNotify}
        />
      </div>

      {/* YouTube */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">YouTube</span>
        <ToggleRow
          label="Hide YouTube Shorts"
          description="Filter Shorts (≤60s) out of every YouTube tab — Subs, Trending, Search, and the rest."
          checked={hideYoutubeShorts}
          onChange={setHideYoutubeShorts}
        />
        <ToggleRow
          label="Subs tab: channel list only"
          description="Show your subscriptions as a channel list instead of a video feed — click a channel to see its uploads."
          checked={youtubeSubsChannelsOnly}
          onChange={setYoutubeSubsChannelsOnly}
        />
      </div>

      {/* Claude */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Claude</span>
        <ToggleRow
          label="Allow tools (write files, run commands)"
          description="⚠ Lets the Claude widget actually create/edit files, run shell commands, and use skills — autonomously, without a prompt (bypassPermissions). Off = chat only. Files are written under ~/.dash. Only enable if you trust it to act on your machine."
          checked={claudeAllowTools}
          onChange={setClaudeAllowTools}
        />
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

      {/* System (Electron only — hidden in the browser) */}
      <SystemPrefsSection />

      {/* Power */}
      <div className="flex flex-col gap-3">
        <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">Power</span>
        <SegmentedRow<LowPowerMode>
          label="Low-power mode"
          value={lowPower}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'on', label: 'On' },
            { value: 'auto', label: 'Auto' },
          ]}
          onChange={setLowPower}
        />
        <p className="text-th-ghost text-[10px] leading-relaxed">
          Slows all widget refresh rates 4×. Auto engages only while on battery
          (requires the Hardware widget for battery detection). Polling always
          pauses while the window is hidden, regardless of this setting.
        </p>
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
        <AutoExportRow />
      </div>

      {/* About + updates (Electron only) */}
      <AboutSection />
    </div>
  );
}

// ── Developer tools row (Electron only) ───────────────────────────────────────

function DevToolsRow() {
  const [restarting, setRestarting] = useState(false);
  if (!window.electron?.restartServer) return null;

  async function restart() {
    setRestarting(true);
    try {
      // Resolves when the child is healthy again; the server:restarted push
      // makes App invalidate all queries.
      await window.electron!.restartServer();
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="flex items-center gap-2 border-t border-th-line pt-4">
      <button
        onClick={() => window.electron?.openLogsFolder()}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
      >
        <FolderOpen size={13} /> Open logs folder
      </button>
      <button
        onClick={() => void restart()}
        disabled={restarting}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] disabled:opacity-50 transition-colors"
      >
        {restarting ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />}
        {restarting ? 'Restarting…' : 'Restart server'}
      </button>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Tab = 'app' | 'alerts' | 'dev';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  // Openers (palette "Open alert settings") can request a starting tab.
  const [tab, setTab] = useState<Tab>(() => useOverlayStore.getState().settingsTab);
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
          {tabBtn('alerts', 'Alerts')}
          {tabBtn('dev', 'Developer')}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
          {tab === 'app' ? (
            <AppSettingsPanel />
          ) : tab === 'alerts' ? (
            <AlertsPanel />
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

              <DevToolsRow />

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
