import { beforeEach, describe, expect, it, vi } from 'vitest';

// persist rehydrates synchronously at module init, so each test seeds storage
// then re-imports a fresh module instance.
async function loadStore() {
  const mod = await import('./discordUiStore');
  return mod.useDiscordUiStore;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('mode', () => {
  it('defaults to embed (pre-native behavior — updates must not surprise)', async () => {
    const store = await loadStore();
    expect(store.getState().mode).toBe('embed');
  });

  it('setMode flips and persists', async () => {
    const store = await loadStore();
    store.getState().setMode('native');
    expect(store.getState().mode).toBe('native');
    const raw = localStorage.getItem('dashboard-discord-ui');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).state).toEqual({ mode: 'native' });
  });

  it('rehydrates a persisted mode', async () => {
    localStorage.setItem(
      'dashboard-discord-ui',
      JSON.stringify({ state: { mode: 'native' }, version: 0 }),
    );
    const store = await loadStore();
    expect(store.getState().mode).toBe('native');
  });

  it('partializes to only { mode } — ephemeral fields must never persist', async () => {
    const store = await loadStore();
    store.getState().setMode('native');
    const persisted = JSON.parse(localStorage.getItem('dashboard-discord-ui') as string);
    expect(Object.keys(persisted.state)).toEqual(['mode']);
  });
});
