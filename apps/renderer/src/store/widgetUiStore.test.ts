import { beforeEach, describe, expect, it, vi } from 'vitest';

// persist rehydrates synchronously at module init, so each test seeds storage
// then re-imports a fresh module instance.
async function loadStore() {
  const mod = await import('./widgetUiStore');
  return mod.useWidgetUiStore;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('collapsed state', () => {
  it('toggleCollapsed flips a widget on and off', async () => {
    const store = await loadStore();
    expect(store.getState().collapsed.weather).toBeUndefined();
    store.getState().toggleCollapsed('weather');
    expect(store.getState().collapsed.weather).toBe(true);
    store.getState().toggleCollapsed('weather');
    expect(store.getState().collapsed.weather).toBe(false);
  });

  it('setCollapsed sets an explicit value without touching siblings', async () => {
    const store = await loadStore();
    store.getState().setCollapsed('spotify', true);
    store.getState().setCollapsed('stocks', false);
    expect(store.getState().collapsed.spotify).toBe(true);
    expect(store.getState().collapsed.stocks).toBe(false);
    expect(store.getState().collapsed.weather).toBeUndefined();
  });
});

describe('persisted shape', () => {
  it('rehydrates the collapsed map from storage', async () => {
    localStorage.setItem(
      'dashboard-widget-ui',
      JSON.stringify({ state: { collapsed: { weather: true } }, version: 0 }),
    );
    const store = await loadStore();
    expect(store.getState().collapsed.weather).toBe(true);
  });

  it('partializes to only { collapsed }', async () => {
    const store = await loadStore();
    store.getState().setCollapsed('notes', true);
    const raw = localStorage.getItem('dashboard-widget-ui');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(Object.keys(persisted.state)).toEqual(['collapsed']);
    expect(persisted.state.collapsed).toEqual({ notes: true });
  });
});
