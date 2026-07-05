// Built-in command-palette action sources. Imported for side effects from
// main.tsx. Each source reads live store state at palette-open time via
// getState() — no hooks, no component coupling, no import cycles.

import { registerActionSource } from './commandRegistry';
import { apiClient } from './apiClient';
import { toast } from './alerts';
import { PRESETS, ALL_WIDGET_IDS, WIDGET_TITLES } from './layouts';
import { THEMES } from '../themes';
import { useLayoutStore } from '../store/layoutStore';
import { useThemeStore } from '../store/themeStore';
import { useAppSettingsStore } from '../store/settingsStore';
import { useTimersStore } from '../store/timersStore';
import { useOverlayStore } from '../store/overlayStore';
import type { LowPowerMode } from '../store/settingsStore';

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
    { id: 'spotify:play', title: 'Spotify: Play', group: 'Spotify', keywords: 'resume music', run: transport('play', 'Play failed') },
    { id: 'spotify:pause', title: 'Spotify: Pause', group: 'Spotify', keywords: 'stop music', run: transport('pause', 'Pause failed') },
    { id: 'spotify:next', title: 'Spotify: Next track', group: 'Spotify', keywords: 'skip music', run: transport('next', 'Skip failed') },
    { id: 'spotify:previous', title: 'Spotify: Previous track', group: 'Spotify', keywords: 'back music', run: transport('previous', 'Skip failed') },
  ];
});

// ── Timers ────────────────────────────────────────────────────────────────────
registerActionSource(() =>
  [5, 10, 25].map((min) => ({
    id: `timer:${min}`,
    title: `Start ${min}-minute timer`,
    group: 'Timers',
    keywords: 'pomodoro countdown',
    run: () => {
      const s = useTimersStore.getState();
      s.addTimer(`${min} min`, min * 60 * 1000);
      // addTimer doesn't start — grab the entry we just appended.
      const timers = useTimersStore.getState().timers;
      const created = timers[timers.length - 1];
      if (created) s.startTimer(created.id);
      toast('Timer started', `${min} minutes`, 'success');
    },
  })),
);

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
  ];
});
