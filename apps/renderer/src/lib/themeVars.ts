// Derives a complete @nish/ui color set (every --nish-* role) from the handful of
// colors an app-local theme defines: Nishboard's extra presets (rose, nord, …) and
// the user's Custom theme. Status, fill, chart and hue colors come from @nish/ui's
// own dark and light themes (`@nish/ui/tokens`, plain data with no React), so they
// never drift from the shared palette. scripts/gen-app-themes.ts runs this under
// plain Node to write src/styles/app-themes.css.
import { THEMES } from '@nish/ui/tokens';

export type Scheme = 'dark' | 'light';

/** Every color role @nish/ui defines, typed (mirrors COLOR_ROLES; a test keeps them in sync). */
export const NISH_COLOR_ROLES = [
  'bg', 'surface', 'elevated', 'overlay', 'line', 'line-strong',
  'hi', 'hi2', 'hi3', 'ghost', 'accent', 'accent2', 'on-accent',
  'on-accent2', 'on-ok', 'on-loss', 'on-warn', 'on-info',
  'ok', 'loss', 'warn', 'info', 'ok-fill', 'loss-fill', 'warn-fill', 'info-fill', 'scrim', 'invert-bg', 'invert-text',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8',
  'emerald', 'indigo', 'amber', 'lime', 'rose', 'sky', 'violet', 'teal',
] as const;

export type ColorRole = (typeof NISH_COLOR_ROLES)[number];
export type ThemeColors = Record<ColorRole, string>;

/** The colors a theme author picks; everything else is derived. */
export interface ThemeBase {
  scheme: Scheme;
  bg: string;
  surface: string;
  elevated: string;
  overlay: string;
  /** Borders; derived between elevated and overlay when omitted. */
  line?: string;
  hi: string;
  hi2: string;
  hi3: string;
  ghost: string;
  accent: string;
  invertBg?: string;
  invertText?: string;
}

/** A role's value in @nish/ui's base theme for this scheme. */
function shared(scheme: Scheme, role: ColorRole): string {
  const v = THEMES[scheme].colors[role];
  if (!v) throw new Error(`@nish/ui ${scheme} theme has no ${role} color`);
  return v;
}

type StatusRole = 'ok' | 'loss' | 'warn' | 'info';

/** Share of the role in a --nish-*-soft tint (tokens.css: color-mix … 14%). */
const SOFT_MIX = 0.14;

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}

/** Linear mix: t = 1 → fully `a`, t = 0 → fully `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i] * t + y[i] * (1 - t)) as Rgb);
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Moves `fg` toward `toward` in small steps until it reaches `min` contrast
 *  against every background, so a theme keeps its hue but stays readable. */
export function ensureContrast(fg: string, bgs: string[], min: number, toward: string): string {
  let out = fg;
  for (let t = 1; t >= 0; t -= 0.05) {
    out = mixHex(fg, toward, t);
    if (bgs.every((bg) => contrast(out, bg) >= min)) return out;
  }
  return toward;
}

/** Like ensureContrast, but `fg` must also read on its own 14% soft tint
 *  (`--nish-<role>-soft`, color-mix over each panel): selected Segmented options,
 *  badges and callouts put the role's text on that tint. */
export function ensureContrastOnSoft(fg: string, bgs: string[], min: number, toward: string): string {
  const ok = (c: string) => bgs.every((bg) => contrast(c, bg) >= min && contrast(c, mixHex(c, bg, SOFT_MIX)) >= min);
  for (let t = 1; t >= 0; t -= 0.05) {
    const out = mixHex(fg, toward, t);
    if (ok(out)) return out;
  }
  return toward;
}

/** Light when the page background is light, else dark. */
export function schemeFor(bg: string): Scheme {
  return luminance(bg) > 0.4 ? 'light' : 'dark';
}

export function deriveThemeColors(base: ThemeBase): ThemeColors {
  const { scheme } = base;
  const extreme = scheme === 'dark' ? '#ffffff' : '#000000';
  const panels = [base.surface, base.elevated];
  const line = base.line && base.line.toLowerCase() !== base.elevated.toLowerCase() ? base.line : mixHex(base.overlay, base.elevated, 0.6);
  const hi = ensureContrast(base.hi, panels, 7, extreme);
  const accent = ensureContrastOnSoft(base.accent, panels, 4.5, hi);
  const onAccent =
    contrast(base.bg, accent) >= 4.5 ? base.bg : contrast('#ffffff', accent) >= contrast('#000000', accent) ? '#ffffff' : '#000000';
  const readable = (c: string) => ensureContrast(c, panels, 4.5, extreme);
  const readableOnSoft = (c: string) => ensureContrastOnSoft(c, panels, 4.5, extreme);
  const ui = (role: ColorRole) => shared(scheme, role);
  const accent2 = readable(ui('accent2'));
  // Bars, meters and chart lines. Dark fills equal the status colors, so they get
  // the same contrast nudge; light fills are brighter than the text-safe colors
  // and are used as they are.
  const fillOf = (s: StatusRole) => (scheme === 'dark' ? readable(ui(`${s}-fill`)) : ui(`${s}-fill`));
  const fill = { ok: fillOf('ok'), loss: fillOf('loss'), warn: fillOf('warn'), info: fillOf('info') };
  // Text and icons on a solid fill: the theme's dark ink or white, whichever
  // reads better on that fill. Light themes use @nish/ui light's ink.
  const darkInk = scheme === 'dark' ? base.bg : shared('light', 'on-ok');
  const on = (bg: string) => (contrast(darkInk, bg) >= contrast('#ffffff', bg) ? darkInk : '#ffffff');
  const colors: ThemeColors = {
    bg: base.bg,
    surface: base.surface,
    elevated: base.elevated,
    overlay: base.overlay,
    line,
    'line-strong': mixHex(hi, base.overlay, 0.2),
    hi,
    hi2: ensureContrast(base.hi2, panels, 4.5, hi),
    hi3: ensureContrast(base.hi3, panels, 4.5, hi),
    ghost: ensureContrast(base.ghost, [base.surface], 3, hi),
    accent,
    accent2,
    'on-accent': onAccent,
    'on-accent2': on(accent2),
    'on-ok': on(fill.ok),
    'on-loss': on(fill.loss),
    'on-warn': on(fill.warn),
    'on-info': on(fill.info),
    ok: readableOnSoft(ui('ok')),
    loss: readableOnSoft(ui('loss')),
    warn: readableOnSoft(ui('warn')),
    info: readableOnSoft(ui('info')),
    'ok-fill': fill.ok,
    'loss-fill': fill.loss,
    'warn-fill': fill.warn,
    'info-fill': fill.info,
    scrim: scheme === 'dark' ? '#000000' : hi,
    'invert-bg': base.invertBg ?? hi,
    'invert-text': base.invertText ?? base.surface,
    'chart-1': ui('chart-1'),
    'chart-2': ui('chart-2'),
    'chart-3': ui('chart-3'),
    'chart-4': ui('chart-4'),
    'chart-5': ui('chart-5'),
    'chart-6': ui('chart-6'),
    'chart-7': ui('chart-7'),
    'chart-8': ui('chart-8'),
    emerald: readable(ui('emerald')),
    indigo: readable(ui('indigo')),
    amber: readable(ui('amber')),
    lime: readable(ui('lime')),
    rose: readable(ui('rose')),
    sky: readable(ui('sky')),
    violet: readable(ui('violet')),
    teal: readable(ui('teal')),
  };
  return colors;
}

/** `{ '--nish-bg': '#…', … }` for an inline style or a CSS block. */
export function toCssVars(colors: ThemeColors): Record<string, string> {
  return Object.fromEntries(NISH_COLOR_ROLES.map((r) => [`--nish-${r}`, colors[r]]));
}
