// Derives a complete @nish/ui color set (every --nish-* role) from the handful of
// colors an app-local theme defines: Nishboard's extra presets (rose, nord, …) and
// the user's Custom theme. Dependency-free on purpose: scripts/gen-app-themes.ts
// runs it under plain Node to write src/styles/app-themes.css.

export type Scheme = 'dark' | 'light';

/** Every color role @nish/ui defines (mirrors COLOR_ROLES in @nish/ui; a test keeps them in sync). */
export const NISH_COLOR_ROLES = [
  'bg', 'surface', 'elevated', 'overlay', 'line', 'line-strong',
  'hi', 'hi2', 'hi3', 'ghost', 'accent', 'accent2', 'on-accent',
  'ok', 'loss', 'warn', 'info', 'scrim', 'invert-bg', 'invert-text',
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

// Status, chart and hue colors follow @nish/ui's dark and light themes, nudged per
// theme only as far as contrast requires.
const STATUS: Record<Scheme, Record<'ok' | 'loss' | 'warn' | 'info' | 'accent2', string>> = {
  dark: { ok: '#34d399', loss: '#f87171', warn: '#fbbf24', info: '#38bdf8', accent2: '#c084fc' },
  light: { ok: '#065f46', loss: '#a91b1b', warn: '#92400e', info: '#075985', accent2: '#7e22ce' },
};
const CHART: Record<Scheme, string[]> = {
  dark: ['#8b93ff', '#34d399', '#fbbf24', '#fb7185', '#38bdf8', '#c084fc', '#fb923c', '#a3e635'],
  light: ['#4f46e5', '#047857', '#b45309', '#be123c', '#0369a1', '#7e22ce', '#c2410c', '#4d7c0f'],
};
const HUES: Record<Scheme, Record<'emerald' | 'indigo' | 'amber' | 'lime' | 'rose' | 'sky' | 'violet' | 'teal', string>> = {
  dark: { emerald: '#34d399', indigo: '#8b93ff', amber: '#fbbf24', lime: '#a3e635', rose: '#fb7185', sky: '#38bdf8', violet: '#c084fc', teal: '#2dd4bf' },
  light: { emerald: '#046d4f', indigo: '#4e45e3', amber: '#9b4708', lime: '#41690d', rose: '#b8113a', sky: '#036499', violet: '#7e22ce', teal: '#0e6b64' },
};

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
  const accent = ensureContrast(base.accent, panels, 4.5, hi);
  const onAccent =
    contrast(base.bg, accent) >= 4.5 ? base.bg : contrast('#ffffff', accent) >= contrast('#000000', accent) ? '#ffffff' : '#000000';
  const readable = (c: string) => ensureContrast(c, panels, 4.5, extreme);
  const status = STATUS[scheme];
  const hues = HUES[scheme];
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
    accent2: readable(status.accent2),
    'on-accent': onAccent,
    ok: readable(status.ok),
    loss: readable(status.loss),
    warn: readable(status.warn),
    info: readable(status.info),
    scrim: scheme === 'dark' ? '#000000' : hi,
    'invert-bg': base.invertBg ?? hi,
    'invert-text': base.invertText ?? base.surface,
    'chart-1': CHART[scheme][0],
    'chart-2': CHART[scheme][1],
    'chart-3': CHART[scheme][2],
    'chart-4': CHART[scheme][3],
    'chart-5': CHART[scheme][4],
    'chart-6': CHART[scheme][5],
    'chart-7': CHART[scheme][6],
    'chart-8': CHART[scheme][7],
    emerald: readable(hues.emerald),
    indigo: readable(hues.indigo),
    amber: readable(hues.amber),
    lime: readable(hues.lime),
    rose: readable(hues.rose),
    sky: readable(hues.sky),
    violet: readable(hues.violet),
    teal: readable(hues.teal),
  };
  return colors;
}

/** `{ '--nish-bg': '#…', … }` for an inline style or a CSS block. */
export function toCssVars(colors: ThemeColors): Record<string, string> {
  return Object.fromEntries(NISH_COLOR_ROLES.map((r) => [`--nish-${r}`, colors[r]]));
}
