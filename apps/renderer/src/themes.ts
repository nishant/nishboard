import { PRESETS, type ThemeName } from '@nish/ui';
import { APP_PRESETS, type AppPresetId } from './lib/appPresets';
import { LEGACY_THEME_IDS } from './lib/legacyThemes';

/** A theme choice: follow the OS, one of the shared @nish/ui themes, one of
 *  Nishboard's own presets, or the user's Custom colors. */
export type ThemeId = 'system' | ThemeName | AppPresetId | 'custom';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  /** Preview dot color (plain CSS color, not a token). */
  swatch: string;
  /** 'mode' = System / Light / Dark; 'preset' = everything else. */
  kind: 'mode' | 'preset' | 'custom';
}

const shared = (id: ThemeName) => PRESETS.find((p) => p.id === id)!;

/** System / Light / Dark — the segmented control in the Themes menu and Settings. */
export const THEME_MODES: ThemeDef[] = [
  { id: 'system', name: 'System', swatch: `linear-gradient(135deg, ${shared('light').colors.bg} 50%, ${shared('dark').colors.bg} 50%)`, kind: 'mode' },
  { id: 'light', name: 'Light', swatch: shared('light').colors.bg, kind: 'mode' },
  { id: 'dark', name: 'Dark', swatch: shared('dark').colors.bg, kind: 'mode' },
];

/** Every named preset: the shared ones first, then Nishboard's own. */
export const THEME_PRESETS: ThemeDef[] = [
  ...PRESETS.filter((p) => p.id !== 'dark' && p.id !== 'light').map(
    (p): ThemeDef => ({ id: p.id, name: p.label, swatch: p.colors.accent, kind: 'preset' }),
  ),
  ...APP_PRESETS.map((p): ThemeDef => ({ id: p.id, name: p.name, swatch: p.swatch, kind: 'preset' })),
];

/** Its swatch is the user's background color; this one only shows before they pick. */
export const CUSTOM_THEME: ThemeDef = { id: 'custom', name: 'Custom', swatch: shared('dark').colors.overlay, kind: 'custom' };

export const THEMES: ThemeDef[] = [...THEME_MODES, ...THEME_PRESETS, CUSTOM_THEME];

export const DEFAULT_THEME: ThemeId = 'dark';


const KNOWN = new Set<string>(THEMES.map((t) => t.id));

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && KNOWN.has(v);
}

/** Map a persisted pre-1 theme id to today's ids; unknown ids fall back to dark. */
export function migrateThemeId(v: unknown): ThemeId {
  const mapped = typeof v === 'string' ? (LEGACY_THEME_IDS[v] ?? v) : v;
  return isThemeId(mapped) ? mapped : DEFAULT_THEME;
}
