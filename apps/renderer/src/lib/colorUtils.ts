import { deriveThemeColors, hexToRgb, mixHex, schemeFor, toCssVars, type Scheme } from './themeVars';

/** Parse '#rrggbb', '#rgb', or 'rgb(r,g,b)' → '#rrggbb' | null */
export function parseHex(input: string): string | null {
  const s = input.trim();

  // rgb(r, g, b)
  const rgbM = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s);
  if (rgbM) {
    const vals = [rgbM[1], rgbM[2], rgbM[3]].map(Number);
    if (vals.every((v) => v >= 0 && v <= 255))
      return '#' + vals.map((v) => v.toString(16).padStart(2, '0')).join('');
    return null;
  }

  // #rrggbb
  const h6 = /^#?([0-9a-f]{6})$/i.exec(s);
  if (h6) return `#${h6[1].toLowerCase()}`;

  // #rgb → #rrggbb
  const h3 = /^#?([0-9a-f]{3})$/i.exec(s);
  if (h3) return '#' + h3[1].split('').map((c) => c + c).join('').toLowerCase();

  return null;
}

/** '#rrggbb' → [r, g, b] */
export function hexToArr(hex: string): [number, number, number] {
  return hexToRgb(hex);
}

/** localStorage key the pre-paint init script reads the Custom theme from. */
export const CUSTOM_VARS_KEY = 'dashboard-theme-custom-vars';

export interface CustomThemeVars {
  scheme: Scheme;
  /** `--nish-*` → '#rrggbb' for every @nish/ui color role. */
  vars: Record<string, string>;
}

/** The full @nish/ui color set for the Custom theme, from the user's 4 colors.
 *  Light or dark follows the background; text tiers and the accent are nudged
 *  only as far as readable contrast needs. Status colors (gains, losses,
 *  warnings) come from the matching shared theme, so they stay recognizable. */
export function buildCustomVars(
  primary: string,
  secondary: string,
  tertiary: string,
  textColor: string,
): CustomThemeVars {
  const scheme = schemeFor(primary);
  const colors = deriveThemeColors({
    scheme,
    bg: primary,
    surface: mixHex(secondary, primary, 0.35), // blend primary → secondary
    elevated: secondary,
    overlay: tertiary,
    line: tertiary,
    hi: textColor,
    hi2: mixHex(textColor, primary, 0.72),
    hi3: mixHex(textColor, primary, 0.5),
    ghost: mixHex(textColor, primary, 0.32),
    accent: secondary,
    invertBg: textColor,
    invertText: primary,
  });
  return { scheme, vars: toCssVars(colors) };
}
