import { describe, expect, it } from 'vitest';
import { nextHostStyle, parseDiscordUnreadCount, zoomForWidth } from './lib';

describe('parseDiscordUnreadCount', () => {
  it('extracts the mention count prefix', () => {
    expect(parseDiscordUnreadCount('(3) Discord | #general | My Server')).toBe(3);
    expect(parseDiscordUnreadCount('(12) Discord')).toBe(12);
    expect(parseDiscordUnreadCount('  (1) Discord | Friends')).toBe(1);
  });

  it('returns 0 when there is no count', () => {
    expect(parseDiscordUnreadCount('Discord | Friends')).toBe(0);
    // "•" marks unread-without-mentions — deliberately not badged.
    expect(parseDiscordUnreadCount('• Discord | #general')).toBe(0);
    expect(parseDiscordUnreadCount('')).toBe(0);
    expect(parseDiscordUnreadCount('Server (3) Discord')).toBe(0);
  });
});

describe('zoomForWidth', () => {
  it('steps down at each breakpoint (boundaries inclusive)', () => {
    expect(zoomForWidth(1400)).toBe(1);
    expect(zoomForWidth(900)).toBe(1);
    expect(zoomForWidth(899)).toBe(0.9);
    expect(zoomForWidth(700)).toBe(0.9);
    expect(zoomForWidth(699)).toBe(0.85);
    expect(zoomForWidth(550)).toBe(0.85);
    expect(zoomForWidth(549)).toBe(0.75);
    expect(zoomForWidth(0)).toBe(0.75);
  });
});

describe('nextHostStyle', () => {
  const rect = { x: 40, y: 60, width: 800, height: 500 };
  const settled = { width: 800, height: 500 };

  it('hides at 0×0 when the tile is gone, settling immediately', () => {
    expect(nextHostStyle(null, false, settled)).toEqual({
      style: { left: 0, top: 0, width: 0, height: 0 },
      settle: 'immediate',
    });
    // Mid-gesture unmount still hides — hidden wins over the freeze.
    expect(nextHostStyle(null, true, settled).style).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  });

  it('adopts the live size in one step when nothing has settled yet', () => {
    expect(nextHostStyle(rect, false, null)).toEqual({
      style: { left: 40, top: 60, width: 800, height: 500 },
      settle: 'immediate',
    });
  });

  it('freezes size but tracks position during a gesture', () => {
    const midResize = { x: 200, y: 90, width: 640, height: 380 };
    expect(nextHostStyle(midResize, true, settled)).toEqual({
      style: { left: 200, top: 90, width: 800, height: 500 },
      settle: 'hold',
    });
  });

  it('holds when the settled size already matches the rect', () => {
    expect(nextHostStyle(rect, false, settled)).toEqual({
      style: { left: 40, top: 60, width: 800, height: 500 },
      settle: 'hold',
    });
  });

  it('keeps the settled size and asks for a debounce on out-of-gesture size changes', () => {
    // e.g. a window resize streaming per-frame rects with interacting=false
    expect(nextHostStyle({ ...rect, width: 820 }, false, settled)).toEqual({
      style: { left: 40, top: 60, width: 800, height: 500 },
      settle: 'debounce',
    });
    expect(nextHostStyle({ ...rect, height: 510 }, false, settled).settle).toBe('debounce');
  });
});
