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

type Rgb = [number, number, number];

/** '#rrggbb' → [r, g, b] */
export function hexToArr(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** [r,g,b] → 'r g b' CSS var triple */
function triple(rgb: Rgb): string {
  return rgb.join(' ');
}

/** '#rrggbb' → 'r g b' */
function hex2triple(hex: string): string {
  return triple(hexToArr(hex));
}

/** Linear mix; t=1 → fully fg */
function mix(fg: Rgb, bg: Rgb, t: number): string {
  return triple(fg.map((v, i) => Math.round(v * t + bg[i] * (1 - t))) as Rgb);
}

/** All 13 CSS var triples for the custom theme from 4 user colours. */
export function buildCustomVars(
  primary: string,
  secondary: string,
  tertiary: string,
  textColor: string,
): Record<string, string> {
  const p  = hexToArr(primary);
  const s  = hexToArr(secondary);
  const tx = hexToArr(textColor);

  return {
    '--t-bg':           hex2triple(primary),
    '--t-bar':          hex2triple(primary),
    '--t-surface':      mix(s, p, 0.35),       // blend primary → secondary
    '--t-elevated':     hex2triple(secondary),
    '--t-overlay':      hex2triple(tertiary),
    '--t-line':         hex2triple(tertiary),
    '--t-hi':           hex2triple(textColor),
    '--t-2':            mix(tx, p, 0.72),
    '--t-3':            mix(tx, p, 0.50),
    '--t-ghost':        mix(tx, p, 0.32),
    '--t-accent':       hex2triple(secondary),
    '--t-invert-bg':    hex2triple(textColor),
    '--t-invert-text':  hex2triple(primary),
  };
}

export const CUSTOM_VAR_KEYS = [
  '--t-bg', '--t-bar', '--t-surface', '--t-elevated', '--t-overlay',
  '--t-line', '--t-hi', '--t-2', '--t-3', '--t-ghost',
  '--t-accent', '--t-invert-bg', '--t-invert-text',
] as const;
