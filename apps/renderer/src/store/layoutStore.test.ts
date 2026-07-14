import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layout } from 'react-grid-layout';

async function loadStore() {
  const mod = await import('./layoutStore');
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('collapsedRowsFor', () => {
  it('needs a couple rows when rowHeight is small (many rows on screen)', async () => {
    const { collapsedRowsFor } = await loadStore();
    // TITLEBAR_PX (34) + gap 8 = 42; (rowHeight 30 + gap 8) = 38 → ceil(42/38) = 2.
    expect(collapsedRowsFor(30, 8)).toBe(2);
  });

  it('collapses to a single row when rowHeight is large (few rows on screen)', async () => {
    const { collapsedRowsFor } = await loadStore();
    expect(collapsedRowsFor(200, 8)).toBe(1);
  });

  it('never returns less than one row', async () => {
    const { collapsedRowsFor } = await loadStore();
    expect(collapsedRowsFor(1000, 8)).toBe(1);
  });
});

describe('pinned custom layouts', () => {
  it('pin is idempotent and unpin removes', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().saveCustomLayout('Work');
    const id = useLayoutStore.getState().savedCustomLayouts[0].id;

    useLayoutStore.getState().pinCustomLayout(id);
    useLayoutStore.getState().pinCustomLayout(id);
    expect(useLayoutStore.getState().pinnedCustomLayouts).toEqual([id]);

    useLayoutStore.getState().unpinCustomLayout(id);
    expect(useLayoutStore.getState().pinnedCustomLayouts).toEqual([]);
  });

  it('deleting a pinned layout also unpins it (no ghost chip)', async () => {
    const { useLayoutStore } = await loadStore();
    useLayoutStore.getState().saveCustomLayout('Work');
    const id = useLayoutStore.getState().savedCustomLayouts[0].id;
    useLayoutStore.getState().pinCustomLayout(id);

    useLayoutStore.getState().deleteCustomLayout(id);
    expect(useLayoutStore.getState().pinnedCustomLayouts).toEqual([]);
  });

  it('rehydrate prunes pinned ids whose layout no longer exists', async () => {
    localStorage.setItem('dashboard-layout', JSON.stringify({
      state: {
        layout: [],
        savedCustomLayouts: [{ id: 'keep', name: 'Keep', layout: [], visibleWidgets: [] }],
        pinnedCustomLayouts: ['keep', 'gone'],
      },
      version: 0,
    }));
    const { useLayoutStore } = await loadStore();
    expect(useLayoutStore.getState().pinnedCustomLayouts).toEqual(['keep']);
  });
});

describe('setWidgetCollapsed', () => {
  function seed(store: { getState: () => { syncLayout: (l: Layout[]) => void } }, layout: Layout[]) {
    store.getState().syncLayout(layout);
  }

  it('collapse locks h (minH=maxH=h, isResizable:false) and saves the prior height', async () => {
    const { useLayoutStore, collapsedRowsFor } = await loadStore();
    seed(useLayoutStore, [{ i: 'weather', x: 0, y: 0, w: 6, h: 8, minW: 4, minH: 2 }]);

    useLayoutStore.getState().setWidgetCollapsed('weather', true, 30, 8);
    const item = useLayoutStore.getState().layout.find((it) => it.i === 'weather');
    const collapsedH = collapsedRowsFor(30, 8);
    expect(item?.h).toBe(collapsedH);
    expect(item?.minH).toBe(collapsedH);
    expect(item?.maxH).toBe(collapsedH);
    expect(item?.isResizable).toBe(false);
    expect(useLayoutStore.getState().savedHeights.weather).toBe(8);
  });

  it('expand restores the saved height, drops maxH, and re-enables resizing', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [{ i: 'weather', x: 0, y: 0, w: 6, h: 8, minW: 4, minH: 2 }]);

    useLayoutStore.getState().setWidgetCollapsed('weather', true, 30, 8);
    useLayoutStore.getState().setWidgetCollapsed('weather', false, 30, 8);

    const item = useLayoutStore.getState().layout.find((it) => it.i === 'weather');
    expect(item?.h).toBe(8);
    expect(item?.maxH).toBeUndefined();
    expect(item?.isResizable).toBe(true);
    expect(item?.minH).toBe(2); // back to WIDGET_CONSTRAINTS floor
    expect(useLayoutStore.getState().savedHeights.weather).toBeUndefined();
  });
});

describe('exactNeighborsBelow', () => {
  const item: Layout = { i: 'hardware', x: 0, y: 0, w: 12, h: 8 };
  const visible = ['hardware', 'weather', 'spotify', 'stocks'] as const;

  it('returns the tiling neighbors sorted by x, even when given out of order', async () => {
    const { exactNeighborsBelow } = await loadStore();
    const right: Layout = { i: 'spotify', x: 6, y: 8, w: 6, h: 8 };
    const left: Layout = { i: 'weather', x: 0, y: 8, w: 6, h: 8 };
    const out = exactNeighborsBelow([item, right, left], [...visible], item, {});
    expect(out?.map((n) => n.i)).toEqual(['weather', 'spotify']);
  });

  it('returns null when a candidate overhangs the span or the tiling has a gap', async () => {
    const { exactNeighborsBelow } = await loadStore();
    const overhang: Layout = { i: 'weather', x: 6, y: 8, w: 8, h: 8 }; // ends at col 14 > 12
    expect(exactNeighborsBelow([item, overhang], [...visible], item, {})).toBeNull();
    const gappy: Layout = { i: 'weather', x: 0, y: 8, w: 6, h: 8 }; // cols 6–11 untiled
    expect(exactNeighborsBelow([item, gappy], [...visible], item, {})).toBeNull();
  });

  it('ignores items at other rows and returns null when nothing starts at the bottom edge', async () => {
    const { exactNeighborsBelow } = await loadStore();
    const lower: Layout = { i: 'weather', x: 0, y: 9, w: 12, h: 7 }; // one row too far down
    expect(exactNeighborsBelow([item, lower], [...visible], item, {})).toBeNull();
  });
});

describe('accordion space exchange', () => {
  // rowHeight 30, gap 8 → collapsedRowsFor = 2 in every test here.
  const RH = 30;
  const GAP = 8;

  function seed(
    store: { getState: () => { syncLayout: (l: Layout[]) => void } },
    layout: Layout[],
  ) {
    store.getState().syncLayout(layout);
  }

  it('expand steals from a same-width neighbor directly below — nothing else moves, total rows constant', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [
      { i: 'weather', x: 0, y: 0, w: 6, h: 2, minW: 3, minH: 2, maxH: 2, isResizable: false },
      { i: 'spotify', x: 0, y: 2, w: 6, h: 14, minW: 3, minH: 2 },
      { i: 'stocks', x: 6, y: 0, w: 18, h: 16, minW: 3, minH: 2 },
    ]);
    useLayoutStore.setState({ savedHeights: { weather: 8 } });

    useLayoutStore.getState().setWidgetCollapsed('weather', false, RH, GAP);

    const byId = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(byId.weather).toMatchObject({ y: 0, h: 8, minH: 2, isResizable: true });
    expect(byId.weather.maxH).toBeUndefined();
    // Neighbor shrank and shifted down — bottom edge (y+h = 16) fixed.
    expect(byId.spotify).toMatchObject({ y: 8, h: 8 });
    // Bystander untouched.
    expect(byId.stocks).toMatchObject({ x: 6, y: 0, w: 18, h: 16 });
    const maxY = Math.max(...useLayoutStore.getState().layout.map((it) => it.y + it.h));
    expect(maxY).toBe(16);
  });

  it('collapse gifts rows to the neighbor below and a collapse→expand cycle round-trips exactly', async () => {
    const { useLayoutStore } = await loadStore();
    const original: Layout[] = [
      { i: 'weather', x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 2, isResizable: true },
      { i: 'spotify', x: 0, y: 8, w: 6, h: 8, minW: 3, minH: 2 },
      { i: 'stocks', x: 6, y: 0, w: 18, h: 16, minW: 3, minH: 2 },
    ];
    seed(useLayoutStore, original.map((it) => ({ ...it })));

    useLayoutStore.getState().setWidgetCollapsed('weather', true, RH, GAP);

    const mid = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(mid.weather).toMatchObject({ h: 2, minH: 2, maxH: 2, isResizable: false });
    // Neighbor grew upward into the freed rows — bottom edge fixed, grid height unchanged.
    expect(mid.spotify).toMatchObject({ y: 2, h: 14 });
    expect(mid.stocks).toMatchObject({ y: 0, h: 16 });
    expect(Math.max(...useLayoutStore.getState().layout.map((it) => it.y + it.h))).toBe(16);
    expect(useLayoutStore.getState().savedHeights.weather).toBe(8);
    expect(useLayoutStore.getState().activePreset).toBeNull();
    expect(useLayoutStore.getState().activeCustomLayoutId).toBeNull();

    useLayoutStore.getState().setWidgetCollapsed('weather', false, RH, GAP);

    expect(useLayoutStore.getState().layout).toEqual(original);
    expect(useLayoutStore.getState().savedHeights.weather).toBeUndefined();
  });

  it('two side-by-side neighbors tiling the span both give on collapse and take back on expand', async () => {
    const { useLayoutStore } = await loadStore();
    const original: Layout[] = [
      { i: 'hardware', x: 0, y: 0, w: 12, h: 8, minW: 3, minH: 2, isResizable: true },
      { i: 'weather', x: 0, y: 8, w: 6, h: 8, minW: 3, minH: 2 },
      { i: 'spotify', x: 6, y: 8, w: 6, h: 8, minW: 3, minH: 2 },
      { i: 'stocks', x: 12, y: 0, w: 12, h: 16, minW: 3, minH: 2 },
    ];
    seed(useLayoutStore, original.map((it) => ({ ...it })));

    useLayoutStore.getState().setWidgetCollapsed('hardware', true, RH, GAP);

    const mid = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(mid.weather).toMatchObject({ y: 2, h: 14 });
    expect(mid.spotify).toMatchObject({ y: 2, h: 14 });
    expect(mid.stocks).toMatchObject({ y: 0, h: 16 });

    useLayoutStore.getState().setWidgetCollapsed('hardware', false, RH, GAP);

    expect(useLayoutStore.getState().layout).toEqual(original);
  });

  it('falls back on expand when the neighbor cannot spare the rows (minH floor)', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [
      { i: 'weather', x: 0, y: 0, w: 6, h: 2, minW: 3, minH: 2, maxH: 2, isResizable: false },
      // 9 − delta(8) = 1 < WIDGET_CONSTRAINTS.spotify.minH (2) → no steal.
      { i: 'spotify', x: 0, y: 2, w: 6, h: 9, minW: 3, minH: 2 },
    ]);
    useLayoutStore.setState({ savedHeights: { weather: 10 } });

    useLayoutStore.getState().setWidgetCollapsed('weather', false, RH, GAP);

    const byId = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(byId.weather).toMatchObject({ h: 10, isResizable: true });
    expect(byId.spotify).toMatchObject({ y: 2, h: 9 }); // untouched — RGL reflow handles it
  });

  it('falls back when the widget directly below is itself collapsed (locked)', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [
      { i: 'weather', x: 0, y: 0, w: 6, h: 2, minW: 3, minH: 2, maxH: 2, isResizable: false },
      { i: 'spotify', x: 0, y: 2, w: 6, h: 2, minW: 2, minH: 2, maxH: 2, isResizable: false },
    ]);
    useLayoutStore.setState({ savedHeights: { weather: 8, spotify: 8 } });

    useLayoutStore.getState().setWidgetCollapsed('weather', false, RH, GAP);

    const byId = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(byId.weather).toMatchObject({ h: 8, isResizable: true });
    expect(byId.spotify).toMatchObject({ y: 2, h: 2, isResizable: false }); // untouched
  });

  it('falls back when the row below does not fully tile the span', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [
      { i: 'hardware', x: 0, y: 0, w: 12, h: 8, minW: 3, minH: 2 },
      // Only cols 0–5 covered; cols 6–11 below hardware are open.
      { i: 'weather', x: 0, y: 8, w: 6, h: 8, minW: 3, minH: 2 },
    ]);

    useLayoutStore.getState().setWidgetCollapsed('hardware', true, RH, GAP);

    const byId = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(byId.hardware).toMatchObject({ h: 2, isResizable: false });
    expect(byId.weather).toMatchObject({ y: 8, h: 8 }); // no gift — plain collapse
  });

  it('falls back when a neighbor sticks out past the expander x-span', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [
      { i: 'weather', x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 2 },
      // Overlaps the span but extends to col 9 > 6.
      { i: 'spotify', x: 0, y: 8, w: 9, h: 8, minW: 3, minH: 2 },
    ]);

    useLayoutStore.getState().setWidgetCollapsed('weather', true, RH, GAP);

    const byId = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(byId.weather).toMatchObject({ h: 2, isResizable: false });
    expect(byId.spotify).toMatchObject({ y: 8, h: 8 }); // untouched
  });

  it('falls back cleanly when nothing sits below the widget', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [{ i: 'weather', x: 0, y: 0, w: 6, h: 8, minW: 3, minH: 2 }]);

    useLayoutStore.getState().setWidgetCollapsed('weather', true, RH, GAP);
    useLayoutStore.getState().setWidgetCollapsed('weather', false, RH, GAP);

    const item = useLayoutStore.getState().layout.find((it) => it.i === 'weather');
    expect(item).toMatchObject({ h: 8, isResizable: true });
  });

  it('ignores hidden widgets for adjacency — never steals from a non-visible item', async () => {
    const { useLayoutStore } = await loadStore();
    seed(useLayoutStore, [
      { i: 'weather', x: 0, y: 0, w: 6, h: 2, minW: 3, minH: 2, maxH: 2, isResizable: false },
      // Would qualify geometrically, but it's hidden.
      { i: 'spotify', x: 0, y: 2, w: 6, h: 14, minW: 3, minH: 2 },
    ]);
    useLayoutStore.setState({
      savedHeights: { weather: 8 },
      visibleWidgets: ['weather', 'stocks'],
    });

    useLayoutStore.getState().setWidgetCollapsed('weather', false, RH, GAP);

    const byId = Object.fromEntries(useLayoutStore.getState().layout.map((it) => [it.i, it]));
    expect(byId.weather).toMatchObject({ h: 8, isResizable: true });
    expect(byId.spotify).toMatchObject({ y: 2, h: 14 }); // hidden — must not be raided
  });
});
