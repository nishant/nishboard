import { describe, it, expect } from 'vitest';
import { clampToDisplays, parseMainBounds, type Rect } from './windowBounds';

const primary: Rect = { x: 0, y: 0, width: 1920, height: 1040 };

describe('clampToDisplays', () => {
  it('keeps an on-screen rect unchanged', () => {
    const r = { x: 100, y: 80, width: 800, height: 600 };
    expect(clampToDisplays(r, [primary], primary)).toEqual(r);
  });

  it('moves a rect from a removed second monitor to the primary, centred', () => {
    const r = { x: 3000, y: 100, width: 800, height: 600 };
    expect(clampToDisplays(r, [primary], primary)).toEqual({ x: 560, y: 220, width: 800, height: 600 });
  });

  it('keeps a rect with 64px overlap and moves one with 63px', () => {
    const keep = { x: 1920 - 64, y: 0, width: 800, height: 600 };
    expect(clampToDisplays(keep, [primary], primary)).toEqual(keep);
    const move = { x: 1920 - 63, y: 0, width: 800, height: 600 };
    expect(clampToDisplays(move, [primary], primary)).not.toEqual(move);
  });

  it('shrinks an oversize window to the work area', () => {
    const out = clampToDisplays({ x: -200, y: -100, width: 3000, height: 2000 }, [primary], primary);
    expect(out).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it('keeps a rect on a monitor with negative coordinates', () => {
    const left: Rect = { x: -1920, y: 0, width: 1920, height: 1040 };
    const r = { x: -1500, y: 100, width: 800, height: 600 };
    expect(clampToDisplays(r, [left, primary], primary)).toEqual(r);
  });
});

describe('parseMainBounds', () => {
  it('accepts a valid file', () => {
    expect(parseMainBounds({ main: { x: 1, y: 2, width: 900, height: 700, maximized: true } }))
      .toEqual({ x: 1, y: 2, width: 900, height: 700, maximized: true });
  });

  it('rejects invalid content', () => {
    expect(parseMainBounds(null)).toBeNull();
    expect(parseMainBounds({})).toBeNull();
    expect(parseMainBounds({ main: { x: 'a', y: 0, width: 900, height: 700 } })).toBeNull();
    expect(parseMainBounds({ main: { x: 0, y: 0, width: 100, height: 700 } })).toBeNull();
    expect(parseMainBounds({ main: { x: 0, y: 0, width: 900, height: 100 } })).toBeNull();
    expect(parseMainBounds({ main: { x: NaN, y: 0, width: 900, height: 700 } })).toBeNull();
  });
});
