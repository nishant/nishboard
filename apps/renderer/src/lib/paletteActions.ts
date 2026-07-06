// Built-in command-palette action sources. Imported for side effects from
// main.tsx. Each source reads live store state at palette-open time via
// getState() — no hooks, no component coupling, no import cycles.

import { registerActionSource, registerParamCommands, registerSourceRefresher } from './commandRegistry';
import type { ParameterizedCommand } from './commandRegistry';
import { apiClient } from './apiClient';
import { toast } from './alerts';
import { fuzzyScore } from './fuzzy';
import { nextOccurrence, parseDateArg, parseDuration, parseTimeOfDay } from './parse';
import { hourFormat } from './time';
import { PRESETS, ALL_WIDGET_IDS, WIDGET_TITLES } from './layouts';
import { THEMES } from '../themes';
import { useLayoutStore } from '../store/layoutStore';
import { useThemeStore } from '../store/themeStore';
import { useAppSettingsStore } from '../store/settingsStore';
import { useTimersStore } from '../store/timersStore';
import { useCountdownStore } from '../store/countdownStore';
import { useTasksStore } from '../store/tasksStore';
import { useNotesStore } from '../store/notesStore';
import { useStocksStore } from '../store/stocksStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useWorldClockStore } from '../store/worldClockStore';
import { useOverlayStore } from '../store/overlayStore';
import { useAlertsStore, describeRule } from '../store/alertsStore';
import type { LowPowerMode } from '../store/settingsStore';
import type { SettingsTab } from '../store/overlayStore';
import type { LauncherStateData } from '@dash/shared';

// ── Layouts ───────────────────────────────────────────────────────────────────
registerActionSource(() => {
  const s = useLayoutStore.getState();
  return [
    ...PRESETS.map((p) => ({
      id: `layout:preset:${p.name}`,
      title: `Apply preset: ${p.name}`,
      group: 'Layouts',
      keywords: 'layout grid',
      run: () => s.applyPreset(p.name),
    })),
    ...s.savedCustomLayouts.map((l) => ({
      id: `layout:custom:${l.id}`,
      title: `Apply layout: ${l.name}`,
      group: 'Layouts',
      keywords: 'custom saved',
      run: () => s.applyCustomLayout(l.id),
    })),
    {
      id: 'layout:reset',
      title: 'Widgets: Reset layout',
      group: 'Layouts',
      keywords: 'default arrange grid',
      run: () => s.resetToDefault(),
    },
  ];
});

// ── Widgets (show/hide reflects current visibility) ───────────────────────────
registerActionSource(() => {
  const s = useLayoutStore.getState();
  return ALL_WIDGET_IDS.map((id) => {
    const visible = s.visibleWidgets.includes(id);
    return {
      id: `widget:${id}`,
      title: `${visible ? 'Hide' : 'Show'} widget: ${WIDGET_TITLES[id]}`,
      group: 'Widgets',
      keywords: 'toggle tile',
      run: () => (visible ? s.hideWidget(id) : s.showWidget(id)),
    };
  });
});

// ── World clock ───────────────────────────────────────────────────────────────
registerActionSource(() => {
  const s = useWorldClockStore.getState();
  return (['digital', 'analog'] as const)
    .filter((view) => view !== s.view)
    .map((view) => ({
      id: `worldclock:view:${view}`,
      title: `World clock: ${view === 'digital' ? 'Digital' : 'Analog'} view`,
      group: 'Widgets',
      keywords: 'clock face time',
      run: () => useWorldClockStore.getState().setView(view),
    }));
});

// ── Appearance ────────────────────────────────────────────────────────────────
registerActionSource(() => {
  const s = useThemeStore.getState();
  return [
    ...THEMES.filter((t) => t.id !== 'custom').map((t) => ({
      id: `theme:${t.id}`,
      title: `Theme: ${t.name}`,
      group: 'Appearance',
      keywords: 'color scheme',
      run: () => s.setTheme(t.id),
    })),
    ...s.savedCustomThemes.map((t) => ({
      id: `theme:custom:${t.id}`,
      title: `Theme: ${t.name}`,
      group: 'Appearance',
      keywords: 'custom color scheme',
      run: () => s.applyCustomTheme(t.id),
    })),
  ];
});

// ── Spotify transport (fire-and-forget through the local API) ─────────────────
registerActionSource(() => {
  const transport = (path: string, label: string) => () => {
    apiClient.post(`/api/spotify/${path}`).catch(() => toast('Spotify unavailable', label, 'error'));
  };
  return [
    { id: 'spotify:play', title: 'Spotify: Play', group: 'Media', keywords: 'resume music', run: transport('play', 'Play failed') },
    { id: 'spotify:pause', title: 'Spotify: Pause', group: 'Media', keywords: 'stop music', run: transport('pause', 'Pause failed') },
    { id: 'spotify:next', title: 'Spotify: Next track', group: 'Media', keywords: 'skip music', run: transport('next', 'Skip failed') },
    { id: 'spotify:previous', title: 'Spotify: Previous track', group: 'Media', keywords: 'back music', run: transport('previous', 'Skip failed') },
  ];
});

// ── Timers ────────────────────────────────────────────────────────────────────
registerActionSource(() =>
  [5, 10, 25].map((min) => ({
    id: `timer:${min}`,
    title: `Start ${min}-minute timer`,
    group: 'Timers',
    keywords: 'pomodoro countdown',
    run: () => startNewTimer(`${min} min`, min * 60 * 1000),
  })),
);

// ── Tasks & Notes ─────────────────────────────────────────────────────────────
registerActionSource(() => [
  {
    id: 'tasks:clear-completed',
    title: 'Tasks: Clear completed',
    group: 'Tasks & Notes',
    keywords: 'done finished remove',
    run: () => useTasksStore.getState().clearCompleted(),
  },
]);

// ── Launcher (async IPC → module-level snapshot, refreshed on palette open) ───
let launcherSnapshot: LauncherStateData = { groups: [], items: [] };

registerSourceRefresher(async () => {
  const next = await window.electron?.launcher?.getItems?.();
  if (next) launcherSnapshot = next;
});

registerActionSource(() => {
  const launcher = window.electron?.launcher;
  if (!launcher) return [];
  return [
    ...launcherSnapshot.items.map((it) => ({
      id: `launcher:item:${it.id}`,
      title: `Launch: ${it.label}`,
      group: 'System',
      keywords: 'open app url shortcut',
      run: () => void launcher.launch(it.id),
    })),
    ...launcherSnapshot.groups.map((g) => ({
      id: `launcher:group:${g.id}`,
      title: `Launch group: ${g.label}`,
      group: 'System',
      keywords: 'open apps batch',
      run: () => void launcher.launchGroup(g.id),
    })),
  ];
});

// ── Alerts ────────────────────────────────────────────────────────────────────
registerActionSource(() => {
  const s = useAlertsStore.getState();
  return [
    {
      id: 'alert:settings',
      title: 'Open alert settings',
      group: 'Alerts',
      keywords: 'rules notify threshold',
      run: () => useOverlayStore.getState().openSettings('alerts'),
    },
    ...s.rules.map((r) => ({
      id: `alert:toggle:${r.id}`,
      title: `${r.enabled ? 'Disable' : 'Enable'} alert: ${describeRule(r)}`,
      group: 'Alerts',
      keywords: 'rule notify',
      run: () => useAlertsStore.getState().toggleRule(r.id),
    })),
  ];
});

// ── App ───────────────────────────────────────────────────────────────────────
registerActionSource(() => {
  const settings = useAppSettingsStore.getState();
  const overlay = useOverlayStore.getState();
  return [
    {
      id: 'app:settings',
      title: 'Open Settings',
      group: 'App',
      keywords: 'preferences options config',
      run: () => overlay.setSettingsOpen(true),
    },
    ...(['off', 'on', 'auto'] as LowPowerMode[])
      .filter((mode) => mode !== settings.lowPower)
      .map((mode) => ({
        id: `app:low-power:${mode}`,
        title: `Low-power mode: ${mode}`,
        group: 'App',
        keywords: 'battery polling refresh',
        run: () => useAppSettingsStore.getState().setLowPower(mode),
      })),
    // Settings one-shots — stable ids, state-dependent titles (like widget
    // show/hide) so each toggle is a single palette entry.
    {
      id: 'settings:temp-unit',
      title: `Weather: Use ${settings.tempUnit === 'f' ? 'Celsius' : 'Fahrenheit'}`,
      group: 'App',
      keywords: 'temperature unit degrees',
      run: () => useAppSettingsStore.getState().setTempUnit(settings.tempUnit === 'f' ? 'c' : 'f'),
    },
    {
      id: 'settings:wind-unit',
      title: `Weather: Wind in ${settings.windUnit === 'mph' ? 'km/h' : 'mph'}`,
      group: 'App',
      keywords: 'speed unit',
      run: () => useAppSettingsStore.getState().setWindUnit(settings.windUnit === 'mph' ? 'kmh' : 'mph'),
    },
    {
      id: 'settings:clock-24h',
      title: settings.clock24h ? 'Clock: 12-hour times' : 'Clock: 24-hour times',
      group: 'App',
      keywords: 'time format ampm military',
      run: () => useAppSettingsStore.getState().setClock24h(!settings.clock24h),
    },
    {
      id: 'settings:density',
      title: `Density: ${settings.density === 'compact' ? 'Comfortable' : 'Compact'}`,
      group: 'App',
      keywords: 'spacing gap grid',
      run: () => useAppSettingsStore.getState().setDensity(settings.density === 'compact' ? 'comfortable' : 'compact'),
    },
    {
      id: 'settings:compact-titlebar',
      title: settings.compactTitlebar ? 'Titlebar: Auto width' : 'Titlebar: Always compact',
      group: 'App',
      keywords: 'header icons',
      run: () => useAppSettingsStore.getState().setCompactTitlebar(!settings.compactTitlebar),
    },
  ];
});

// ── Parameterized commands ("timer 25m tea", "volume 40", …) ──────────────────

/** addTimer doesn't start — grab the entry we just appended and start it. */
function startNewTimer(label: string, ms: number): void {
  const s = useTimersStore.getState();
  s.addTimer(label, ms);
  const timers = useTimersStore.getState().timers;
  const created = timers[timers.length - 1];
  if (created) s.startTimer(created.id);
  toast('Timer started', label, 'success');
}

/** Longest token-prefix of `args` that `parse` accepts; remainder = label. */
function splitArgAndLabel<T>(args: string, parse: (s: string) => T | null): { value: T; label: string } | null {
  const tokens = args.split(/\s+/).filter(Boolean);
  let best: { value: T; count: number } | null = null;
  for (let n = 1; n <= tokens.length; n++) {
    const value = parse(tokens.slice(0, n).join(' '));
    if (value !== null) best = { value, count: n };
  }
  return best ? { value: best.value, label: tokens.slice(best.count).join(' ') } : null;
}

/** "1h 05m 03s" / "25m" / "45s" — preview counterpart of the parse.ts grammar. */
function fmtDurationParts(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(h > 0 ? `${pad(m)}m` : `${m}m`);
  if (s > 0) parts.push(h > 0 || m > 0 ? `${pad(s)}s` : `${s}s`);
  return parts.join(' ') || '0s';
}

function fmtWallClock(at: number): string {
  const clock24h = useAppSettingsStore.getState().clock24h;
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...hourFormat(clock24h) });
}

function fmtWallDateTime(at: number): string {
  const clock24h = useAppSettingsStore.getState().clock24h;
  return new Date(at).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...hourFormat(clock24h),
  });
}

/** Strict integer in [min, max]; tolerates a trailing "%" ("volume 40%"). */
function parseIntArg(s: string, min: number, max: number): number | null {
  const m = /^(\d{1,3})%?$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n >= min && n <= max ? n : null;
}

// Intl.supportedValuesOf is ES2022 — missing from our ES2020 lib (and from
// older runtimes), so reach it through a typed optional shape.
let zoneCache: string[] | null = null;
function allTimeZones(): string[] {
  if (zoneCache === null) {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
    zoneCache = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  }
  return zoneCache;
}

interface FillableCommand extends ParameterizedCommand {
  /** Title of the discoverability row that prefills "<trigger> ". */
  fillTitle: string;
}

const PARAM_COMMANDS: FillableCommand[] = [
  {
    id: 'param:timer',
    triggers: ['timer', 't'],
    group: 'Timers',
    argHint: '<duration> [label] — e.g. 25m, 1h 5m tea, 1:30',
    fillTitle: 'Start a timer…',
    parse: (args) => {
      const split = splitArgAndLabel(args, parseDuration);
      if (!split) return null;
      const { value: ms, label } = split;
      return {
        preview: `Start timer: ${fmtDurationParts(ms)}${label ? ` — "${label}"` : ''}`,
        run: () => startNewTimer(label || 'Timer', ms),
      };
    },
  },
  {
    id: 'param:alarm',
    triggers: ['alarm'],
    group: 'Timers',
    argHint: '<time> [label] — e.g. 7:30pm wake up, 19:05',
    fillTitle: 'Set an alarm…',
    parse: (args) => {
      const split = splitArgAndLabel(args, parseTimeOfDay);
      if (!split) return null;
      const { value: { h, m }, label } = split;
      const today = new Date();
      today.setHours(h, m, 0, 0);
      const tomorrow = today.getTime() <= Date.now();
      const clock = fmtWallClock(today.getTime());
      return {
        preview: `Set alarm: ${clock}${tomorrow ? ' (tomorrow)' : ''}${label ? ` — "${label}"` : ''}`,
        run: () => {
          // Resolve the target at run time, not parse time — midnight edge.
          useTimersStore.getState().addAlarm(label || 'Alarm', nextOccurrence(h, m));
          toast('Alarm set', clock, 'success');
        },
      };
    },
  },
  {
    id: 'param:countdown',
    triggers: ['countdown', 'cd'],
    group: 'Timers',
    argHint: '<date> [time] [label] — e.g. 12/25 party, 2026-12-25 7pm launch',
    fillTitle: 'Add a countdown…',
    parse: (args) => {
      const split = splitArgAndLabel(args, parseDateArg);
      if (!split) return null;
      const { value: at, label } = split;
      const when = fmtWallDateTime(at);
      return {
        preview: `Add countdown: ${when}${label ? ` — "${label}"` : ''}`,
        run: () => {
          useCountdownStore.getState().addEvent(label || 'Countdown', at);
          toast('Countdown added', when, 'success');
        },
      };
    },
  },
  {
    id: 'param:task',
    triggers: ['task'],
    group: 'Tasks & Notes',
    argHint: '<text>',
    fillTitle: 'Add a task…',
    parse: (args) => {
      const text = args.trim();
      if (!text) return null;
      return {
        preview: `Add task: ${text}`,
        run: () => {
          useTasksStore.getState().addTask(text);
          toast('Task added', text, 'success');
        },
      };
    },
  },
  {
    id: 'param:note',
    triggers: ['note'],
    group: 'Tasks & Notes',
    argHint: '<text>',
    fillTitle: 'New note with text…',
    parse: (args) => {
      const text = args.trim();
      if (!text) return null;
      return {
        preview: `New note: ${text}`,
        run: () => {
          useNotesStore.getState().addNoteWithText(text);
          toast('Note created', text, 'success');
        },
      };
    },
  },
  {
    id: 'param:volume',
    triggers: ['volume', 'vol'],
    group: 'System',
    argHint: '<0–100>',
    fillTitle: 'Set system volume…',
    parse: (args) => {
      const n = parseIntArg(args, 0, 100);
      if (n === null) return null;
      return {
        preview: `Set system volume: ${n}%`,
        run: () => {
          apiClient
            .post('/api/sound/volume', { volumePercent: n })
            .catch(() => toast('Sound unavailable', 'Volume change failed', 'error'));
        },
      };
    },
  },
  {
    id: 'param:spotify',
    triggers: ['spotify'],
    group: 'Media',
    argHint: 'volume <0–100> · shuffle on|off · repeat off|track|context',
    fillTitle: 'Spotify: volume / shuffle / repeat…',
    parse: (args) => {
      const [sub = '', ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const arg = rest.join(' ').toLowerCase();
      const send = (path: string, body: unknown, label: string) => () => {
        apiClient.post(`/api/spotify/${path}`, body).catch(() => toast('Spotify unavailable', label, 'error'));
      };
      switch (sub.toLowerCase()) {
        case 'volume':
        case 'vol': {
          const n = parseIntArg(arg, 0, 100);
          if (n === null) return null;
          return { preview: `Spotify volume: ${n}%`, run: send('volume', { volumePercent: n }, 'Volume failed') };
        }
        case 'shuffle': {
          if (arg !== 'on' && arg !== 'off') return null;
          return { preview: `Spotify shuffle: ${arg}`, run: send('shuffle', { state: arg === 'on' }, 'Shuffle failed') };
        }
        case 'repeat': {
          if (arg !== 'off' && arg !== 'track' && arg !== 'context') return null;
          return { preview: `Spotify repeat: ${arg}`, run: send('repeat', { state: arg }, 'Repeat failed') };
        }
        default:
          return null;
      }
    },
  },
  {
    id: 'param:ticker',
    triggers: ['ticker'],
    group: 'Widgets',
    argHint: '[remove] <symbol> — e.g. AAPL',
    fillTitle: 'Add or remove a stock ticker…',
    parse: (args) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const removing = tokens[0]?.toLowerCase() === 'remove';
      const raw = removing ? tokens[1] : tokens[0];
      if (!raw || tokens.length > (removing ? 2 : 1) || !/^[A-Za-z.]{1,6}$/.test(raw)) return null;
      const sym = raw.toUpperCase();
      return {
        preview: `${removing ? 'Remove' : 'Add'} ticker: ${sym}`,
        run: () => {
          const s = useStocksStore.getState();
          if (removing) s.removeTicker(sym);
          else s.addTicker(sym);
          toast(removing ? 'Ticker removed' : 'Ticker added', sym, 'success');
        },
      };
    },
  },
  {
    id: 'param:coin',
    triggers: ['coin'],
    group: 'Widgets',
    argHint: '<coingecko id> — e.g. bitcoin, ethereum',
    fillTitle: 'Add a crypto coin…',
    parse: (args) => {
      const id = args.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return null;
      return {
        preview: `Add coin: ${id}`,
        run: () => {
          useCryptoStore.getState().addCoin(id);
          toast('Coin added', id, 'success');
        },
      };
    },
  },
  {
    id: 'param:zone',
    triggers: ['zone'],
    group: 'Widgets',
    argHint: '<city or timezone> — e.g. tokyo, america/denver',
    fillTitle: 'Add a world clock…',
    parse: (args) => {
      const q = args.trim();
      if (!q) return null;
      // Fuzzy over the IANA list ("_" → " " so "los angeles" matches).
      let best: string | null = null;
      let bestScore = -1;
      for (const zone of allTimeZones()) {
        const score = fuzzyScore(q, zone.replace(/_/g, ' '));
        if (score > bestScore) {
          bestScore = score;
          best = zone;
        }
      }
      if (best === null) return null;
      const tz = best;
      return {
        preview: `Add clock: ${tz}`,
        run: () => {
          useWorldClockStore.getState().addZone(tz);
          toast('Clock added', tz, 'success');
        },
      };
    },
  },
  {
    id: 'param:scale',
    triggers: ['scale'],
    group: 'Appearance',
    argHint: '<80–150> — UI scale percent',
    fillTitle: 'Set UI scale…',
    parse: (args) => {
      const n = parseIntArg(args, 80, 150);
      if (n === null) return null;
      // Store holds a zoom FACTOR (1 = 100%), clamped to the Settings modal's
      // 80–140% range.
      const factor = Math.min(1.4, Math.max(0.8, n / 100));
      const pct = Math.round(factor * 100);
      return {
        preview: `Set UI scale: ${pct}%`,
        run: () => {
          useAppSettingsStore.getState().setUiScale(factor);
          toast('UI scale', `${pct}%`, 'success');
        },
      };
    },
  },
  {
    id: 'param:settings',
    triggers: ['>', 'settings'],
    group: 'App',
    argHint: 'app | alerts | dev',
    fillTitle: 'Open a settings tab…',
    parse: (args) => {
      const q = args.trim();
      if (!q) return null;
      const names: Record<SettingsTab, string> = { app: 'App', alerts: 'Alerts', dev: 'Developer' };
      let best: SettingsTab | null = null;
      let bestScore = -1;
      for (const tab of Object.keys(names) as SettingsTab[]) {
        const score = fuzzyScore(q, names[tab]);
        if (score > bestScore) {
          bestScore = score;
          best = tab;
        }
      }
      if (best === null) return null;
      const tab = best;
      return {
        preview: `Open settings: ${names[tab]}`,
        run: () => useOverlayStore.getState().openSettings(tab),
      };
    },
  },
];

registerParamCommands(PARAM_COMMANDS);

// One discoverability row per parameterized command — selecting it prefills
// the input ("timer ") instead of running. Same id as the command, so an
// execution's recents entry resolves back to this row.
registerActionSource(() =>
  PARAM_COMMANDS.map((c) => ({
    id: c.id,
    title: c.fillTitle,
    group: c.group,
    keywords: c.triggers.join(' '),
    fill: `${c.triggers[0]} `,
    run: () => undefined,
  })),
);
