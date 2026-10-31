import { describe, expect, it } from 'vitest';
import type { Layout } from 'react-grid-layout';
import type { WidgetId } from './layouts';
import {
  ALL_WIDGET_IDS, applyConstraints, autoFillLayout, DEFAULT_LAYOUT, generateLayout, PRESETS,
  WIDGET_CATEGORIES, deriveNarrowLayout, gridColumnsFor,
} from './layouts';

const COLS = 24;
const ROWS = 22;

function overlaps(a: Layout, b: Layout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function assertNoOverlaps(layout: Layout[]): void {
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      expect(overlaps(layout[i], layout[j]), `${layout[i].i} overlaps ${layout[j].i}`).toBe(false);
    }
  }
}

describe('static PRESETS', () => {
  for (const preset of PRESETS) {
    it(`"${preset.name}" is gap-free on the 24×22 grid`, () => {
      // Full coverage: total area = grid area, and no two widgets overlap —
      // together those guarantee zero gaps.
      const area = preset.layout.reduce((sum, l) => sum + l.w * l.h, 0);
      expect(area).toBe(COLS * ROWS);
      assertNoOverlaps(preset.layout);
      for (const l of preset.layout) {
        expect(l.x).toBeGreaterThanOrEqual(0);
        expect(l.y).toBeGreaterThanOrEqual(0);
        expect(l.x + l.w).toBeLessThanOrEqual(COLS);
        expect(l.y + l.h).toBeLessThanOrEqual(ROWS);
      }
    });
  }

  it('DEFAULT_LAYOUT is the first preset', () => {
    expect(DEFAULT_LAYOUT).toBe(PRESETS[0]);
  });
});

describe('WIDGET_CATEGORIES', () => {
  it('partitions ALL_WIDGET_IDS exactly — every widget in exactly one category', () => {
    // Adding a widget without slotting it into a category fails here.
    const flat = WIDGET_CATEGORIES.flatMap((c) => c.widgets);
    expect(new Set(flat).size, 'a widget id appears in more than one category').toBe(flat.length);
    expect([...flat].sort()).toEqual([...ALL_WIDGET_IDS].sort());
  });

  it('has unique category ids and no empty categories', () => {
    const ids = WIDGET_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of WIDGET_CATEGORIES) expect(c.widgets.length).toBeGreaterThan(0);
  });
});

describe('generateLayout (BSP)', () => {
  const presetWidgets = (name: string): WidgetId[] =>
    (PRESETS.find((p) => p.name === name)?.layout.map((l) => l.i) ?? []) as WidgetId[];

  for (const preset of PRESETS) {
    it(`"${preset.name}" with all its widgets visible covers the grid`, () => {
      const ids = presetWidgets(preset.name);
      const layout = generateLayout(preset.name, ids, COLS, ROWS);
      expect(layout).not.toBeNull();
      const area = layout!.reduce((sum, l) => sum + l.w * l.h, 0);
      expect(area).toBe(COLS * ROWS);
      assertNoOverlaps(layout!);
      expect(layout!.map((l) => l.i).sort()).toEqual([...ids].sort());
    });
  }

  it('hiding a widget re-flows gap-free (sibling absorbs the region)', () => {
    const ids = presetWidgets('Default').filter((id) => id !== 'weather');
    const layout = generateLayout('Default', ids, COLS, ROWS);
    expect(layout).not.toBeNull();
    expect(layout!.some((l) => l.i === 'weather')).toBe(false);
    expect(layout!.reduce((sum, l) => sum + l.w * l.h, 0)).toBe(COLS * ROWS);
    assertNoOverlaps(layout!);
  });

  it('widgets missing from a preset tree are appended below without overlap', () => {
    // "Home" has no twitch leaf — it must still get a slot when visible.
    const ids = [...presetWidgets('Home'), 'twitch' as WidgetId];
    const layout = generateLayout('Home', ids, COLS, ROWS);
    expect(layout).not.toBeNull();
    const twitch = layout!.find((l) => l.i === 'twitch');
    expect(twitch).toBeDefined();
    expect(twitch!.y).toBeGreaterThanOrEqual(ROWS); // appended below the grid
    assertNoOverlaps(layout!);
  });

  it('returns null for an unknown preset or an all-hidden set', () => {
    expect(generateLayout('Nope', ['weather'], COLS, ROWS)).toBeNull();
    expect(generateLayout('Default', [], COLS, ROWS)).toBeNull();
  });
});

describe('autoFillLayout', () => {
  it('appends every missing widget id below the existing layout', () => {
    const partial: Layout[] = [{ i: 'weather', x: 0, y: 0, w: 24, h: 10 }];
    const filled = autoFillLayout(partial);
    expect(filled.map((l) => l.i).sort()).toEqual([...ALL_WIDGET_IDS].sort());
    assertNoOverlaps(filled);
    // Appended rows start below the tallest existing widget.
    for (const l of filled.slice(1)) expect(l.y).toBeGreaterThanOrEqual(10);
  });

  it('is a no-op when everything is present', () => {
    const layout = generateLayout('Default', ALL_WIDGET_IDS, COLS, ROWS)!;
    expect(autoFillLayout(layout)).toBe(layout);
  });
});

describe('applyConstraints', () => {
  it('overwrites stale persisted mins with the authoritative constraints', () => {
    const stale: Layout[] = [{ i: 'weather', x: 0, y: 0, w: 6, h: 8, minW: 12, minH: 9 }];
    const [fixed] = applyConstraints(stale);
    expect(fixed.minW).toBe(3); // uniform minW across all widgets
    expect(fixed.minH).toBe(2);
  });

  it('clamps every widget to minW 3', () => {
    const items: Layout[] = ALL_WIDGET_IDS.map((id, idx) => ({
      i: id, x: 0, y: idx, w: 8, h: 4, minW: 8, minH: 8,
    }));
    for (const fixed of applyConstraints(items)) {
      expect(fixed.minW).toBe(3);
    }
  });

  it('leaves unknown ids untouched', () => {
    const item: Layout = { i: 'not-a-widget', x: 0, y: 0, w: 2, h: 2, minW: 9 };
    expect(applyConstraints([item])[0]).toBe(item);
  });
});

describe('gridColumnsFor', () => {
  it('maps width boundaries to column counts', () => {
    expect(gridColumnsFor(599)).toBe(1);
    expect(gridColumnsFor(600)).toBe(2);
    expect(gridColumnsFor(899)).toBe(2);
    expect(gridColumnsFor(900)).toBe(3);
    expect(gridColumnsFor(1199)).toBe(3);
    expect(gridColumnsFor(1200)).toBe(24);
  });
});

describe('deriveNarrowLayout', () => {
  const item = (i: string, x: number, y: number, h: number): Layout => ({ i, x, y, w: 6, h });
  const desktop: Layout[] = [item('c', 12, 0, 10), item('a', 0, 0, 10), item('b', 0, 10, 2), item('d', 0, 12, 30)];

  it('stacks one column in (y, x) order with scaled, clamped heights', () => {
    const out = deriveNarrowLayout(desktop, 1, new Set(), 2);
    expect(out.map((l) => l.i)).toEqual(['a', 'c', 'b', 'd']);
    expect(out.every((l) => l.x === 0 && l.w === 1)).toBe(true);
    expect(out.map((l) => l.h)).toEqual([14, 14, 6, 24]);
    expect(out.map((l) => l.y)).toEqual([0, 14, 28, 34]);
  });

  it('balances two columns, ties going to the leftmost', () => {
    const out = deriveNarrowLayout(desktop, 2, new Set(), 2);
    const by = Object.fromEntries(out.map((l) => [l.i, l]));
    expect(by.a.x).toBe(0);
    expect(by.c.x).toBe(1);
    expect(by.b.x).toBe(0);
    expect(by.d.x).toBe(1);
    expect(by.b.y).toBe(14);
    expect(by.d.y).toBe(14);
  });

  it('uses collapsedRows for collapsed ids and marks items static', () => {
    const out = deriveNarrowLayout(desktop, 3, new Set(['a']), 3);
    const a = out.find((l) => l.i === 'a');
    expect(a?.h).toBe(3);
    expect(out.every((l) => l.static && l.isDraggable === false && l.isResizable === false)).toBe(true);
  });

  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(desktop)) as Layout[];
    deriveNarrowLayout(desktop, 2, new Set(['a']), 2);
    expect(desktop).toEqual(copy);
  });
});
