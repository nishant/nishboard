import { beforeEach, describe, expect, it, vi } from 'vitest';

// The persist middleware rehydrates synchronously from localStorage at module
// init, so each test seeds storage and re-imports a fresh module instance.
async function loadStore() {
  const mod = await import('./settingsStore');
  return mod.useAppSettingsStore;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('dashboard-app-settings v0 → v1 migration', () => {
  it('wraps a single weatherZip into weatherZips', async () => {
    localStorage.setItem('dashboard-app-settings', JSON.stringify({ state: { weatherZip: '02139' }, version: 0 }));
    const store = await loadStore();
    const s = store.getState();
    expect(s.weatherZips).toEqual(['02139']);
    expect('weatherZip' in s).toBe(false);
  });

  it('migrates an empty v0 zip to an empty list (auto-detect)', async () => {
    localStorage.setItem('dashboard-app-settings', JSON.stringify({ state: { weatherZip: '' }, version: 0 }));
    const store = await loadStore();
    expect(store.getState().weatherZips).toEqual([]);
  });

  it('passes v1 state through untouched', async () => {
    localStorage.setItem(
      'dashboard-app-settings',
      JSON.stringify({ state: { weatherZips: ['60601', '02139'], clock24h: true }, version: 1 }),
    );
    const store = await loadStore();
    expect(store.getState().weatherZips).toEqual(['60601', '02139']);
    expect(store.getState().clock24h).toBe(true);
  });

  it('new keys get defaults when absent from persisted state (shallow merge)', async () => {
    localStorage.setItem('dashboard-app-settings', JSON.stringify({ state: { weatherZips: [] }, version: 1 }));
    const store = await loadStore();
    expect(store.getState().weatherAlertNotify).toBe('severe');
    expect(store.getState().twitchLiveNotify).toBe(true);
  });
});

describe('setters', () => {
  it('setWeatherZips resets the cycle index (it may point past the new list)', async () => {
    const store = await loadStore();
    store.getState().setWeatherZips(['1', '2', '3']);
    store.getState().setWeatherZipIdx(2);
    store.getState().setWeatherZips(['9']);
    expect(store.getState().weatherZipIdx).toBe(0);
    expect(store.getState().weatherZips).toEqual(['9']);
  });
});
