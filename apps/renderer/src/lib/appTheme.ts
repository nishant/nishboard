// Applies a Nishboard theme choice to <html>. Shared themes (and 'system') go
// through @nish/ui's setThemeChoice, which also saves `nish-theme`; app-local
// presets and the Custom theme paint their own data-theme on top, keeping
// `nish-theme` at their light/dark scheme so anything reading it stays sensible.
// public/theme-init-app.js does the same before first paint — keep them in step.
import { isThemeName, setThemeChoice } from '@nish/ui';
import { APP_PRESETS } from './appPresets';
import { CUSTOM_VARS_KEY, type CustomThemeVars } from './colorUtils';
import { NISH_COLOR_ROLES } from './themeVars';
import type { ThemeId } from '../themes';

const CUSTOM_VAR_NAMES = NISH_COLOR_ROLES.map((r) => `--nish-${r}`);

function clearCustomVars(root: HTMLElement): void {
  for (const k of CUSTOM_VAR_NAMES) root.style.removeProperty(k);
}

function paint(root: HTMLElement, theme: string, scheme: 'dark' | 'light'): void {
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-scheme', scheme);
  root.style.colorScheme = scheme;
}

/** Apply a theme choice now. `custom` is required when theme === 'custom'. */
export function applyAppTheme(theme: ThemeId, custom?: CustomThemeVars): void {
  const root = document.documentElement;
  clearCustomVars(root);

  if (theme === 'system' || isThemeName(theme)) {
    setThemeChoice(theme);
    return;
  }

  if (theme === 'custom') {
    if (!custom) return;
    setThemeChoice(custom.scheme);
    paint(root, 'custom', custom.scheme);
    for (const [k, v] of Object.entries(custom.vars)) root.style.setProperty(k, v);
    try {
      localStorage.setItem(CUSTOM_VARS_KEY, JSON.stringify(custom));
    } catch {
      // storage blocked: the theme still applies for this session
    }
    return;
  }

  const preset = APP_PRESETS.find((p) => p.id === theme);
  if (!preset) {
    setThemeChoice('dark');
    return;
  }
  setThemeChoice(preset.base.scheme);
  paint(root, preset.id, preset.base.scheme);
}
