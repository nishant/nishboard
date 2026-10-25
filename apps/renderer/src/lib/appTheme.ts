// Applies a Nishboard theme choice to <html> through @nish/ui. Nishboard's own
// presets and the Custom theme are registered with registerThemes, so
// setThemeChoice accepts them and saves them to `nish-theme` like any shared
// theme. src/theme-init-app.js sets the same ids on window.__nishExtraThemes
// before first paint — keep the two in step.
import { isThemeName, registerThemes, setThemeChoice } from '@nish/ui';
import { APP_PRESETS } from './appPresets';
import { CUSTOM_VARS_KEY, type CustomThemeVars } from './colorUtils';
import { NISH_COLOR_ROLES } from './themeVars';
import type { ThemeId } from '../themes';

registerThemes({
  ...Object.fromEntries(APP_PRESETS.map((p) => [p.id, p.base.scheme])),
  // Always known, so a 'custom' saved by another window is never read as invalid;
  // its real scheme comes from theme-init-app.js or applyAppTheme below.
  custom: 'dark',
  ...(typeof window === 'undefined' ? undefined : window.__nishExtraThemes),
});

const CUSTOM_VAR_NAMES = NISH_COLOR_ROLES.map((r) => `--nish-${r}`);

/** Apply a theme choice now. `custom` is required when theme === 'custom'. */
export function applyAppTheme(theme: ThemeId, custom?: CustomThemeVars): void {
  const root = document.documentElement;
  for (const k of CUSTOM_VAR_NAMES) root.style.removeProperty(k);

  if (theme === 'custom') {
    if (!custom) return;
    registerThemes({ custom: custom.scheme });
    for (const [k, v] of Object.entries(custom.vars)) root.style.setProperty(k, v);
    try {
      localStorage.setItem(CUSTOM_VARS_KEY, JSON.stringify(custom));
    } catch {
      // storage blocked: the theme still applies for this session
    }
  }
  setThemeChoice(theme === 'system' || isThemeName(theme) ? theme : 'dark');
}
