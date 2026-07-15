import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetCategory } from '../lib/layouts';

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

  it('partializes to only { collapsed, menuOrder }', async () => {
    const store = await loadStore();
    store.getState().setCollapsed('notes', true);
    const raw = localStorage.getItem('dashboard-widget-ui');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(Object.keys(persisted.state).sort()).toEqual(['collapsed', 'menuOrder']);
    expect(persisted.state.collapsed).toEqual({ notes: true });
  });

  it('back-fills menuOrder for stored states that predate it', async () => {
    localStorage.setItem(
      'dashboard-widget-ui',
      JSON.stringify({ state: { collapsed: {} }, version: 0 }),
    );
    const store = await loadStore();
    expect(store.getState().menuOrder).toEqual({});
  });
});

describe('orderedCategoryWidgets', () => {
  // Synthetic category — the helper is pure and takes any WidgetCategory.
  const cat: WidgetCategory = {
    id: 'media',
    label: 'Media',
    widgets: ['spotify', 'youtube', 'twitch', 'discord'],
  };

  async function helper() {
    const mod = await import('./widgetUiStore');
    return mod.orderedCategoryWidgets;
  }

  it('returns the default order when nothing is persisted', async () => {
    const orderedCategoryWidgets = await helper();
    expect(orderedCategoryWidgets(cat, {})).toEqual(['spotify', 'youtube', 'twitch', 'discord']);
  });

  it('returns the persisted order when present', async () => {
    const orderedCategoryWidgets = await helper();
    expect(
      orderedCategoryWidgets(cat, { media: ['discord', 'twitch', 'youtube', 'spotify'] }),
    ).toEqual(['discord', 'twitch', 'youtube', 'spotify']);
  });

  it('appends ids missing from the persisted order in default order (new widgets)', async () => {
    const orderedCategoryWidgets = await helper();
    // A persisted order from before "twitch" and "discord" joined the category.
    expect(orderedCategoryWidgets(cat, { media: ['youtube', 'spotify'] })).toEqual([
      'youtube', 'spotify', 'twitch', 'discord',
    ]);
  });

  it('drops persisted ids that are no longer in the category', async () => {
    const orderedCategoryWidgets = await helper();
    expect(
      orderedCategoryWidgets(cat, { media: ['weather', 'discord', 'spotify', 'youtube', 'twitch'] }),
    ).toEqual(['discord', 'spotify', 'youtube', 'twitch']);
  });
});

describe('moveWidget', () => {
  it('swaps a widget with its neighbor and persists the full category order', async () => {
    const store = await loadStore();
    // Default media order: spotify, youtube, twitch, discord.
    store.getState().moveWidget('media', 'youtube', -1);
    expect(store.getState().menuOrder.media).toEqual(['youtube', 'spotify', 'twitch', 'discord']);
    store.getState().moveWidget('media', 'youtube', 1);
    expect(store.getState().menuOrder.media).toEqual(['spotify', 'youtube', 'twitch', 'discord']);
  });

  it('no-ops moving the first widget up or the last widget down', async () => {
    const store = await loadStore();
    store.getState().moveWidget('media', 'spotify', -1);
    expect(store.getState().menuOrder.media).toBeUndefined();
    store.getState().moveWidget('media', 'discord', 1);
    expect(store.getState().menuOrder.media).toBeUndefined();
  });

  it('no-ops for unknown category or widget ids', async () => {
    const store = await loadStore();
    store.getState().moveWidget('nope', 'spotify', 1);
    store.getState().moveWidget('media', 'weather', 1); // weather isn't in media
    expect(store.getState().menuOrder).toEqual({});
  });

  it('moves within the merged order when the persisted order predates new widgets', async () => {
    localStorage.setItem(
      'dashboard-widget-ui',
      JSON.stringify({ state: { collapsed: {}, menuOrder: { media: ['youtube', 'spotify'] } }, version: 0 }),
    );
    const store = await loadStore();
    // Merged display order: youtube, spotify, twitch, discord.
    store.getState().moveWidget('media', 'twitch', -1);
    expect(store.getState().menuOrder.media).toEqual(['youtube', 'twitch', 'spotify', 'discord']);
  });
});

describe('menuOrder rehydrate pruning', () => {
  it('prunes ids that left a category and drops unknown category keys', async () => {
    localStorage.setItem(
      'dashboard-widget-ui',
      JSON.stringify({
        state: {
          collapsed: {},
          menuOrder: {
            media: ['twitch', 'weather', 'spotify'], // weather no longer in media
            bogus: ['spotify'], // category that no longer exists
          },
        },
        version: 0,
      }),
    );
    const store = await loadStore();
    expect(store.getState().menuOrder).toEqual({ media: ['twitch', 'spotify'] });
  });
});
