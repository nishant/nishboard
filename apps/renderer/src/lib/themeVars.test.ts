import { describe, expect, it } from 'vitest';
import { buildCustomVars } from './colorUtils';
import { contrast, hexToRgb, schemeFor } from './themeVars';

describe('hexToRgb', () => {
  it('parses 6- and 3-digit hex, with or without the hash', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#f80')).toEqual([255, 136, 0]);
  });
});

describe('schemeFor', () => {
  it('picks the scheme whose text extreme contrasts more with the background', () => {
    expect(schemeFor('#000000')).toBe('dark');
    expect(schemeFor('#ffffff')).toBe('light');
    // Mid-gray: black text reaches about 5.3:1, white only about 3.9:1.
    expect(schemeFor('#808080')).toBe('light');
  });
});

describe('buildCustomVars with a mid-tone background', () => {
  it('derives text that reads at 4.5:1 on a #808080 background', () => {
    const { scheme, vars } = buildCustomVars('#808080', '#808080', '#707070', '#808080');
    expect(scheme).toBe('light');
    for (const role of ['hi', 'hi2', 'hi3'] as const) {
      for (const panel of ['--nish-surface', '--nish-elevated'] as const) {
        const ratio = contrast(vars[`--nish-${role}`] ?? '', vars[panel] ?? '');
        expect(ratio, `${role} on ${panel}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
