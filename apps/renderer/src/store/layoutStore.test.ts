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
