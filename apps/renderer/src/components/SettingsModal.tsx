import { useState, useEffect, useId, useRef } from 'react';
import { X, Eye, EyeOff, Check, Lock, Minus, Plus, Download, Upload, FolderOpen, RotateCw, FolderSync, Terminal } from 'lucide-react';
import { CREDENTIAL_DEFS, CREDENTIAL_KEYS } from '@dash/shared';
import type { CredentialKey, AppPrefsData, UpdateCheckData } from '@dash/shared';
import { useAppSettingsStore } from '../store/settingsStore';
import type { Density, TempUnit, WindUnit, LowPowerMode, WeatherAlertNotify } from '../store/settingsStore';
import { useLayoutStore } from '../store/layoutStore';
import { WIDGET_CATEGORIES, WIDGET_TITLES } from '../lib/layouts';
import type { WidgetId } from '../lib/layouts';
import { useQueryClient } from '@tanstack/react-query';
import { exportSettings, importSettings } from '../lib/backup';
import { apiClient } from '../lib/apiClient';
import { SegmentedRow } from './settings/controls';
import { openClaudeCliLogin } from '../widgets/claude/useClaude';
import { AlertsPanel } from './settings/AlertsPanel';
import { useOverlayStore } from '../store/overlayStore';
import { useThemeStore } from '../store/themeStore';
import { CUSTOM_THEME, THEMES, THEME_PRESETS } from '../themes';
import {
  Badge, Button, Callout, Field, IconButton, Modal, SkeletonLines, Switch, TabPanel, Tabs, ThemeToggle, cn,
} from '@nish/ui';
import { Input, Select } from './nishGaps';

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
  const inputId = useId();

  const showInput = !isSet || edit?.mode === 'set';
  const pendingClear = isSet && edit?.mode === 'clear';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        {showInput ? (
          <label htmlFor={inputId} className="text-th-hi3 text-[11px] w-28 shrink-0">{label}</label>
        ) : (
          <span className="text-th-hi3 text-[11px] w-28 shrink-0">{label}</span>
        )}

        {showInput ? (
          <div className="flex-1 flex items-center gap-1.5">
            <Input
              id={inputId}
              size="sm"
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
              aria-describedby={hint ? `${inputId}-hint` : undefined}
              className="flex-1 font-mono"
            />
            <IconButton label={visible ? 'Hide value' : 'Show value'} size="sm" active={visible} onClick={() => setVisible((v) => !v)}>
              {visible ? <EyeOff size={13} /> : <Eye size={13} />}
            </IconButton>
            {isSet && (
              <IconButton label="Keep the saved value" size="sm" onClick={() => onEdit(undefined)}>
                <X size={13} />
              </IconButton>
            )}
          </div>
        ) : pendingClear ? (
          <div className="flex-1 flex items-center gap-2">
            <Badge tone="warn">Will be removed on save</Badge>
            <Button variant="link" size="xs" onClick={() => onEdit(undefined)}>
              Undo
            </Button>
          </div>
        ) : (
          <div className="flex-1 flex items-center gap-2">
            <span className="text-th-hi text-[11px] font-mono tracking-widest">••••••••</span>
            <span className="text-th-hi3 text-[10px]">saved</span>
            <div className="ml-auto flex items-center gap-1">
              <Button size="xs" variant="subtle" onClick={() => onEdit({ mode: 'set', value: '' })}>
                Replace
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onEdit({ mode: 'clear' })} className="hover:text-th-loss hover:bg-th-loss-soft">
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>
      {hint && (
        <p id={`${inputId}-hint`} className="text-th-hi3 text-[10px] leading-relaxed pl-[calc(7rem+0.75rem)]">{hint}</p>
      )}
    </div>
  );
}

function BuiltinRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-th-hi3 text-[11px] w-28 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 text-th-hi3 text-[11px]">
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
      <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">About</span>
      <div className="flex items-center gap-3">
        <span className="text-th-hi3 text-[11px] w-28 shrink-0">Version</span>
        <span className="text-th-hi text-[11px] font-mono">{version ?? '…'}</span>
        <Button size="sm" variant="subtle" loading={checking} onClick={() => void check()} className="ml-auto">
          Check for updates
        </Button>
      </div>
      {result && (
        <div className="text-[10px] leading-relaxed pl-[calc(7rem+0.75rem)] flex flex-col gap-1">
          {result.hasUpdate && result.latestVersion ? (
            <>
              <Button
                variant="link"
                size="xs"
                onClick={() => result.url && window.electron?.openExternal(result.url)}
                className="self-start"
              >
                v{result.latestVersion} is available — open release page
              </Button>
              {result.assetUrl && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => window.electron?.openExternal(result.assetUrl!)}
                  title={result.assetName ?? undefined}
                  className="self-start"
                >
                  Download v{result.latestVersion} ({result.assetName?.endsWith('.dmg') ? 'DMG' : 'EXE'})
                </Button>
              )}
            </>
          ) : (
            <span className="text-th-hi3">{result.message ?? 'You are up to date.'}</span>
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
        <Button size="sm" variant="subtle" icon={<FolderSync size={13} />} onClick={() => void choose()}>
          {dir ? 'Change folder' : 'Auto-export…'}
        </Button>
        {dir && (
          <>
            <span className="text-th-hi3 text-[10px] font-mono truncate flex-1 min-w-0" title={dir}>{dir}</span>
            <Button variant="link" size="xs" onClick={() => void disable()} className="text-th-hi3 hover:text-th-loss">
              Disable
            </Button>
          </>
        )}
      </div>
      <p className="text-th-hi3 text-[10px] leading-relaxed">
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
      <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">System</span>
      <SegmentedRow<AppPrefsData['closeAction']>
        label="Close button"
        value={prefs.closeAction}
        options={[{ value: 'quit', label: 'Quit' }, { value: 'tray', label: 'Hide to tray' }]}
        onChange={(v) => void update({ closeAction: v })}
      />
      <Switch
        size="sm"
        labelSide="end"
        label="Global show/hide hotkey"
        description="Ctrl+Shift+D (Cmd+Shift+D on macOS) toggles the dashboard from anywhere."
        checked={prefs.globalHotkey}
        onChange={(v) => void update({ globalHotkey: v })}
      />
      <p className="text-th-hi3 text-[10px] leading-relaxed">
        The tray icon is always available: show/hide, Spotify play/pause, restart server, quit.
      </p>
    </div>
  );
}

// ── Widgets section (enable/disable per widget) ───────────────────────────────

function WidgetsSection() {
  const disabledWidgets = useAppSettingsStore((s) => s.disabledWidgets);
  const toggleWidgetDisabled = useAppSettingsStore((s) => s.toggleWidgetDisabled);

  function onToggle(id: WidgetId, enabled: boolean) {
    toggleWidgetDisabled(id);
    if (!enabled) {
      // Disabling: unpin from the grid now (BSP layouts reflow gap-free) and
      // close a floating popout if one is open. Only the disabled flag is new
      // state — re-enabling does NOT auto-pin; pin from the Widgets menu.
      useLayoutStore.getState().hideWidget(id);
      window.electron?.popout?.close(id);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Widgets</span>
      <p className="text-th-hi3 text-[10px] leading-relaxed">
        Disabled widgets disappear everywhere — the Widgets menu, the layout editor, the grid,
        and the command palette. Re-enabling doesn&apos;t pin the widget back; pin it from the
        Widgets menu.
      </p>
      {WIDGET_CATEGORIES.map((category) => (
        <div key={category.id} className="flex flex-col gap-2">
          <span className="text-th-hi3 text-[10px] uppercase tracking-wider font-medium">
            {category.label}
          </span>
          <div className="flex flex-col gap-2 pl-2">
            {category.widgets.map((id) => (
              <Switch
                key={id}
                size="sm"
                labelSide="end"
                label={WIDGET_TITLES[id]}
                checked={!disabledWidgets.includes(id)}
                onChange={(v) => onToggle(id, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Appearance (theme) ────────────────────────────────────────────────────────

function AppearanceSection() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const isPreset = THEME_PRESETS.some((t) => t.id === theme) || theme === 'custom';
  return (
    <div className="flex flex-col gap-3">
      <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Appearance</span>
      <div className="flex items-center gap-3">
        <span className="text-th-hi3 text-[11px] w-28 shrink-0">Theme</span>
        <ThemeToggle labels />
      </div>
      <Field layout="inline" label="Preset">
        <Select
          size="sm"
          value={isPreset ? theme : ''}
          onChange={(e) => {
            const id = THEMES.find((t) => t.id === e.target.value)?.id;
            if (id) setTheme(id);
          }}
          className="max-w-56"
        >
          <option value="">{isPreset ? 'Preset…' : 'None (System / Light / Dark)'}</option>
          {[...THEME_PRESETS, CUSTOM_THEME].map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
      <p className="text-th-hi3 text-[10px] leading-relaxed">
        Light and Dark are the shared nish.software themes; System follows your OS. Custom colors are edited from the
        Themes menu in the title bar.
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
    youtubeSubsChannelsOnly, claudeWorkspaceDir, claudeAdditionalDirs,
    setWeatherZips, setShowTempInClock, setUiScale, setDensity, setCompactTitlebar,
    setTempUnit, setWindUnit, setClock24h, setLowPower, setWeatherAlertNotify, setTwitchLiveNotify,
    setHideYoutubeShorts, setYoutubeSubsChannelsOnly, setClaudeWorkspaceDir, setClaudeAdditionalDirs,
  } = useAppSettingsStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [importError, setImportError] = useState<string | null>(null);

  // Free-form while typing; committed on blur/Enter (same pattern as ZIPs).
  const [claudeDirsText, setClaudeDirsText] = useState(() => claudeAdditionalDirs.join(', '));
  function commitClaudeDirs() {
    const dirs = [...new Set(
      claudeDirsText.split(',').map((d) => d.trim())
        .filter((d) => d.startsWith('/') || d === '~' || d.startsWith('~/') || /^[A-Za-z]:[\\/]/.test(d)),
    )].slice(0, 10);
    setClaudeAdditionalDirs(dirs);
    setClaudeDirsText(dirs.join(', '));
  }

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
      <AppearanceSection />

      {/* Weather */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Weather</span>
        <Field
          layout="inline"
          label="Locations (ZIP)"
          hint="One or more 5-digit US ZIPs, comma-separated — the weather widget's ‹ › cycles between them. Leave blank to detect automatically."
        >
          <Input
            size="sm"
            value={zipsText}
            onChange={(e) => setZipsText(e.target.value.replace(/[^0-9,\s]/g, ''))}
            onBlur={commitZips}
            onKeyDown={(e) => { if (e.key === 'Enter') commitZips(); }}
            placeholder="Auto (by IP)"
            inputMode="numeric"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
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
        <p className="text-th-hi3 text-[10px] leading-relaxed">
          New NWS weather alerts chime, toast, and send a native notification.
          Severe = Extreme/Severe alerts only.
        </p>
      </div>

      {/* Twitch */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Twitch</span>
        <Switch
          size="sm"
          labelSide="end"
          label="Go-live alerts"
          description="Chime, toast, and native notification when a followed channel goes live. Needs a connected Twitch account (widget → Connect)."
          checked={twitchLiveNotify}
          onChange={setTwitchLiveNotify}
        />
      </div>

      {/* YouTube */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">YouTube</span>
        <Switch
          size="sm"
          labelSide="end"
          label="Hide YouTube Shorts"
          description="Filter Shorts (≤60s) out of every YouTube tab — Subs, Trending, Search, and the rest."
          checked={hideYoutubeShorts}
          onChange={setHideYoutubeShorts}
        />
        <Switch
          size="sm"
          labelSide="end"
          label="Subs tab: channel list only"
          description="Show your subscriptions as a channel list instead of a video feed — click a channel to see its uploads."
          checked={youtubeSubsChannelsOnly}
          onChange={setYoutubeSubsChannelsOnly}
        />
      </div>

      {/* Claude */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Claude</span>
        <Field
          layout="inline"
          label="Workspace"
          hint="Where the Claude widget's CLI runs — file operations are relative to this folder. Absolute path or ~-prefixed."
        >
          <Input
            size="sm"
            value={claudeWorkspaceDir}
            onChange={(e) => setClaudeWorkspaceDir(e.target.value)}
            placeholder="~/.dash (default)"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field
          layout="inline"
          label="Extra folders"
          hint="Comma-separated folders Claude may also read/write (beyond the workspace). Default ~ = your whole home directory. In Ask mode writes still prompt; ⚠ in Auto mode Claude can change anything in these folders without asking."
        >
          <Input
            size="sm"
            value={claudeDirsText}
            onChange={(e) => setClaudeDirsText(e.target.value)}
            onBlur={commitClaudeDirs}
            onKeyDown={(e) => { if (e.key === 'Enter') commitClaudeDirs(); }}
            placeholder="~ (home)"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <Field
          layout="inline"
          label="CLI login"
          hint={
            <>
              Opens a terminal running <code className="bg-th-elevated px-1 py-0.5 rounded">claude auth login</code> —
              finish sign-in in the browser (bills your Claude subscription, not API keys).
              The terminal closes itself once you&apos;re logged in.
            </>
          }
        >
          <Button size="sm" variant="subtle" icon={<Terminal size={13} />} onClick={() => void openClaudeCliLogin()} className="justify-self-start">
            Log in to Claude CLI
          </Button>
        </Field>
      </div>

      {/* Units & time */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Units &amp; time</span>
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
        <Switch
          size="sm"
          labelSide="end"
          label="24-hour clock"
          description="Applies to the titlebar clock, world clock, alarms and countdowns."
          checked={clock24h}
          onChange={setClock24h}
        />
      </div>

      {/* Top bar */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Top bar</span>
        <Switch
          size="sm"
          labelSide="end"
          label="Show temperature"
          description="Display the current temperature next to the clock."
          checked={showTempInClock}
          onChange={setShowTempInClock}
        />
        <Switch
          size="sm"
          labelSide="end"
          label="Compact titlebar"
          description="Always use icon-only menus and a pinned-layouts dropdown. Off = compact only on narrow windows."
          checked={compactTitlebar}
          onChange={setCompactTitlebar}
        />
      </div>

      {/* Display */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Display</span>

        <div className="flex items-center gap-3">
          <span className="text-th-hi3 text-[11px] w-28 shrink-0">UI scale</span>
          <div className="flex items-center gap-2">
            <IconButton label="Smaller" size="xs" variant="subtle" onClick={() => setUiScale(clampScale(uiScale - 0.1))} disabled={uiScale <= SCALE_MIN}>
              <Minus size={12} />
            </IconButton>
            <span className="text-th-hi text-[11px] tabular-nums w-10 text-center">{Math.round(uiScale * 100)}%</span>
            <IconButton label="Larger" size="xs" variant="subtle" onClick={() => setUiScale(clampScale(uiScale + 0.1))} disabled={uiScale >= SCALE_MAX}>
              <Plus size={12} />
            </IconButton>
            {uiScale !== 1 && (
              <Button variant="link" size="xs" onClick={() => setUiScale(1)} className="ml-1">
                Reset
              </Button>
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

      {/* Widgets (enable/disable) */}
      <WidgetsSection />

      {/* System (Electron only — hidden in the browser) */}
      <SystemPrefsSection />

      {/* Power */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Power</span>
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
        <p className="text-th-hi3 text-[10px] leading-relaxed">
          Slows all widget refresh rates 4×. Auto engages only while on battery
          (requires the Hardware widget for battery detection). Polling always
          pauses while the window is hidden, regardless of this setting.
        </p>
      </div>

      {/* Backup */}
      <div className="flex flex-col gap-3">
        <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">Backup</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="subtle" icon={<Download size={13} />} onClick={exportSettings}>
            Export
          </Button>
          <Button size="sm" variant="subtle" icon={<Upload size={13} />} onClick={() => fileRef.current?.click()}>
            Import
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImportFile} className="hidden" />
        </div>
        {importError && (
          <p role="alert" className="text-th-loss text-[10px] leading-relaxed">{importError}</p>
        )}
        <p className="text-th-hi3 text-[10px] leading-relaxed">
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
      <Button size="sm" variant="subtle" icon={<FolderOpen size={13} />} onClick={() => window.electron?.openLogsFolder()}>
        Open logs folder
      </Button>
      <Button size="sm" variant="subtle" icon={<RotateCw size={13} />} loading={restarting} onClick={() => void restart()}>
        {restarting ? 'Restarting…' : 'Restart server'}
      </Button>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Tab = 'app' | 'alerts' | 'dev';

const TABS: { value: Tab; label: string }[] = [
  { value: 'app', label: 'App' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'dev', label: 'Developer' },
];

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

  // Escape, backdrop click and focus trapping come from @nish/ui's Modal.

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

  const footer =
    tab === 'dev' ? (
      <div className="flex w-full items-center justify-between gap-3">
        {saveState === 'error' ? (
          <span className="text-th-loss text-[11px]">Failed to save — the server didn't restart cleanly. Try again.</span>
        ) : saveState === 'saving' ? (
          <span className="text-th-hi3 text-[11px]">Restarting server with new keys…</span>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          variant={saveState === 'saved' ? 'secondary' : 'primary'}
          onClick={handleSave}
          disabled={saveState === 'saving' || loading || !hasChanges}
          loading={saveState === 'saving'}
          icon={saveState === 'saved' ? <Check size={12} className="text-th-ok" /> : undefined}
        >
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save'}
        </Button>
      </div>
    ) : undefined;

  return (
    <Modal title="Settings" onClose={onClose} className="sm:max-w-[480px]" footer={footer}>
        {/* Tabs — the tablist is pinned while the body scrolls */}
        <Tabs
          label="Settings sections"
          size="sm"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          items={TABS}
          className="sticky top-0 z-10 -mx-5 mb-4 bg-th-surface px-5"
        >
          <TabPanel value="app" className="flex flex-col gap-6">
            <AppSettingsPanel />
          </TabPanel>
          <TabPanel value="alerts" className="flex flex-col gap-6">
            <AlertsPanel />
          </TabPanel>
          <TabPanel value="dev" className="flex flex-col gap-6">
          {loading ? (
            <SkeletonLines lines={4} />
          ) : (
            <>
              {SERVICES.map((service) => {
                const defs = CREDENTIAL_DEFS.filter((d) => d.service === service);
                return (
                  <div key={service} className="flex flex-col gap-3">
                    <span className="text-th-hi2 text-xs font-semibold uppercase tracking-wider">
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
                <Callout compact tone="warn">
                  OS keychain unavailable — keys will be stored unencrypted on this device's disk.
                </Callout>
              )}
              <p className={cn(
                'text-th-hi3 text-[10px] leading-relaxed',
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
          </TabPanel>
        </Tabs>
    </Modal>
  );
}
