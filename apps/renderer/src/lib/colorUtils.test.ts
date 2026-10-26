import { describe, expect, it } from 'vitest';
import { COLOR_ROLES, THEMES } from '@nish/ui/tokens';
import { APP_PRESETS } from './appPresets';
import { buildCustomVars, hexToArr, parseHex } from './colorUtils';
import { contrast, deriveThemeColors, mixHex, NISH_COLOR_ROLES } from './themeVars';

describe('parseHex', () => {
  it('normalizes 6-digit hex with or without the hash', () => {
    expect(parseHex('#AaBbCc')).toBe('#aabbcc');
    expect(parseHex('aabbcc')).toBe('#aabbcc');
    expect(parseHex('  #aabbcc  ')).toBe('#aabbcc');
  });

  it('expands 3-digit hex', () => {
    expect(parseHex('#abc')).toBe('#aabbcc');
    expect(parseHex('F80')).toBe('#ff8800');
  });

  it('converts rgb() and rejects out-of-range channels', () => {
    expect(parseHex('rgb(255, 0, 10)')).toBe('#ff000a');
    expect(parseHex('RGB(0,0,0)')).toBe('#000000');
    expect(parseHex('rgb(300, 0, 0)')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('#ab')).toBeNull();
    expect(parseHex('#gggggg')).toBeNull();
    expect(parseHex('blue')).toBeNull();
  });
});

describe('hexToArr', () => {
  it('splits into rgb channels', () => {
    expect(hexToArr('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToArr('000000')).toEqual([0, 0, 0]);
  });
});

describe('buildCustomVars', () => {
  const custom = buildCustomVars('#101010', '#202020', '#303030', '#f0f0f0');

  it('emits a --nish-* value for every @nish/ui color role', () => {
    expect(NISH_COLOR_ROLES).toEqual(COLOR_ROLES);
    expect(Object.keys(custom.vars).sort()).toEqual(COLOR_ROLES.map((r) => `--nish-${r}`).sort());
  });

  it('maps the anchor colours directly', () => {
    expect(custom.vars['--nish-bg']).toBe('#101010'); // primary
    expect(custom.vars['--nish-elevated']).toBe('#202020'); // secondary
    expect(custom.vars['--nish-overlay']).toBe('#303030'); // tertiary
    expect(custom.vars['--nish-hi']).toBe('#f0f0f0'); // text
    // Inverted pair swaps primary and text.
    expect(custom.vars['--nish-invert-bg']).toBe('#f0f0f0');
    expect(custom.vars['--nish-invert-text']).toBe('#101010');
  });

  it('every value is a #rrggbb hex', () => {
    for (const v of Object.values(custom.vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('picks light or dark from the background', () => {
    expect(custom.scheme).toBe('dark');
    expect(buildCustomVars('#fafafa', '#ffffff', '#dddddd', '#111111').scheme).toBe('light');
  });

  it('keeps text tiers readable even from low-contrast picks', () => {
    const muddy = buildCustomVars('#202020', '#2a2a2a', '#333333', '#555555');
    for (const role of ['hi', 'hi2', 'hi3', 'accent', 'ok', 'loss']) {
      expect(contrast(muddy.vars[`--nish-${role}`], muddy.vars['--nish-elevated'])).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('deriveThemeColors', () => {
  it('takes chart and fill colors from @nish/ui tokens, not local copies', () => {
    for (const preset of APP_PRESETS) {
      const colors = deriveThemeColors(preset.base);
      const shared = THEMES[preset.base.scheme].colors;
      const charts = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8'] as const;
      for (const c of charts) expect(colors[c]).toBe(shared[c]);
      if (preset.base.scheme === 'light') {
        for (const s of ['ok', 'loss', 'warn', 'info'] as const) expect(colors[`${s}-fill`]).toBe(shared[`${s}-fill`]);
      }
    }
  });

  it('keeps accent and status text readable on their own soft tint', () => {
    for (const preset of APP_PRESETS) {
      const colors = deriveThemeColors(preset.base);
      for (const role of ['accent', 'ok', 'loss', 'warn', 'info'] as const) {
        for (const panel of [colors.surface, colors.elevated]) {
          const soft = mixHex(colors[role], panel, 0.14);
          expect(contrast(colors[role], soft), `${preset.id} ${role}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
