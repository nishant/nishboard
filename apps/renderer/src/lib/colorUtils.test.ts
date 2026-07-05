import { describe, expect, it } from 'vitest';
import { buildCustomVars, CUSTOM_VAR_KEYS, hexToArr, parseHex } from './colorUtils';

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
  const vars = buildCustomVars('#101010', '#202020', '#303030', '#f0f0f0');

  it('emits exactly the CUSTOM_VAR_KEYS set', () => {
    expect(Object.keys(vars).sort()).toEqual([...CUSTOM_VAR_KEYS].sort());
  });

  it('maps the anchor colours directly', () => {
    expect(vars['--t-bg']).toBe('16 16 16'); // primary
    expect(vars['--t-elevated']).toBe('32 32 32'); // secondary
    expect(vars['--t-overlay']).toBe('48 48 48'); // tertiary
    expect(vars['--t-hi']).toBe('240 240 240'); // text
    // Inverted pair swaps primary and text.
    expect(vars['--t-invert-bg']).toBe('240 240 240');
    expect(vars['--t-invert-text']).toBe('16 16 16');
  });

  it('every value is an "r g b" triple in range', () => {
    for (const v of Object.values(vars)) {
      const parts = v.split(' ').map(Number);
      expect(parts).toHaveLength(3);
      for (const n of parts) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(255);
        expect(Number.isInteger(n)).toBe(true);
      }
    }
  });
});
