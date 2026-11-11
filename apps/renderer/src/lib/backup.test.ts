import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackupPayload, importSettings } from './backup';

function backupFile(payload: unknown): File {
  return new File([JSON.stringify(payload)], 'settings.json', { type: 'application/json' });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importSettings', () => {
  it('rejects files from other apps and unknown versions', async () => {
    await expect(importSettings(backupFile({ app: 'other', version: 1, data: {} }))).rejects.toThrow(
      'Not a Nishboard settings file',
    );
    await expect(importSettings(backupFile({ app: 'nishboard', version: 2, data: {} }))).rejects.toThrow(
      'Unsupported settings-file version',
    );
    await expect(importSettings(backupFile({ app: 'nishboard', version: 1 }))).rejects.toThrow();
  });

  it('restores known keys and dashboard-* keys only — a crafted file cannot write arbitrary storage', async () => {
    await importSettings(
      backupFile({
        app: 'nishboard',
        version: 1,
        data: {
          'dashboard-app-settings': { state: { clock24h: true }, version: 1 },
          'stocks-watchlist': ['AAPL'],
          'evil-key': 'pwned',
          'spotify-token': 'nope',
        },
      }),
    );
    expect(localStorage.getItem('dashboard-app-settings')).toBe(JSON.stringify({ state: { clock24h: true }, version: 1 }));
    // Legacy key from old backups — the watchlist now lives in trading.
    expect(localStorage.getItem('stocks-watchlist')).toBeNull();
    expect(localStorage.getItem('evil-key')).toBeNull();
    expect(localStorage.getItem('spotify-token')).toBeNull();
  });

  it('accepts a persist envelope exported as a JSON string, and skips non-envelope strings', async () => {
    const env = JSON.stringify({ state: { a: 1 }, version: 0 });
    await importSettings(
      backupFile({ app: 'nishboard', version: 1, data: { 'dashboard-notes': env, 'dashboard-tasks': 'raw-string' } }),
    );
    expect(localStorage.getItem('dashboard-notes')).toBe(env);
    expect(localStorage.getItem('dashboard-tasks')).toBeNull();
  });

  it('rejects a file over 5 MB before reading it', async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.json');
    await expect(importSettings(big)).rejects.toThrow('too large');
  });

  it('skips keys that are not persist envelopes and keeps the existing value', async () => {
    localStorage.setItem('dashboard-layout', JSON.stringify({ state: { ok: true }, version: 1 }));
    await importSettings(
      backupFile({
        app: 'nishboard',
        version: 1,
        data: {
          'dashboard-layout': { state: 'a string', version: 1 },
          'dashboard-theme': { state: {}, version: 'x' },
          'dashboard-app-settings': [1, 2],
          'hardware-config': { state: { visible: {} }, version: 0 },
        },
      }),
    );
    expect(localStorage.getItem('dashboard-layout')).toBe(JSON.stringify({ state: { ok: true }, version: 1 }));
    expect(localStorage.getItem('dashboard-theme')).toBeNull();
    expect(localStorage.getItem('dashboard-app-settings')).toBeNull();
    expect(localStorage.getItem('hardware-config')).not.toBeNull();
  });

  it('restores the previous values when a write fails partway', async () => {
    const before = JSON.stringify({ state: { old: true }, version: 1 });
    localStorage.setItem('dashboard-layout', before);
    const realSet = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      calls++;
      if (calls === 2) throw new Error('QuotaExceededError');
      realSet.call(this, k, v);
    });
    await expect(
      importSettings(
        backupFile({
          app: 'nishboard',
          version: 1,
          data: {
            'dashboard-layout': { state: { fresh: true }, version: 1 },
            'dashboard-theme': { state: {}, version: 1 },
          },
        }),
      ),
    ).rejects.toThrow('QuotaExceededError');
    expect(localStorage.getItem('dashboard-layout')).toBe(before);
    expect(localStorage.getItem('dashboard-theme')).toBeNull();
  });
});

describe('buildBackupPayload', () => {
  it('snapshots known keys plus every dashboard-* key, parsing JSON values', () => {
    localStorage.setItem('dashboard-app-settings', JSON.stringify({ state: {}, version: 1 }));
    localStorage.setItem('dashboard-future-widget', JSON.stringify({ a: 1 }));
    localStorage.setItem('hardware-config', JSON.stringify({ a: 2 }));
    localStorage.setItem('unrelated', 'x');

    const payload = buildBackupPayload();
    expect(payload.app).toBe('nishboard');
    expect(payload.version).toBe(1);
    expect(payload.data['dashboard-app-settings']).toEqual({ state: {}, version: 1 });
    expect(payload.data['dashboard-future-widget']).toEqual({ a: 1 });
    expect(payload.data['hardware-config']).toEqual({ a: 2 });
    expect('unrelated' in payload.data).toBe(false);
  });

  it('round-trips through importSettings', async () => {
    localStorage.setItem('dashboard-theme', JSON.stringify({ state: { theme: 'slate' }, version: 0 }));
    const payload = buildBackupPayload();
    localStorage.clear();
    await importSettings(backupFile(payload));
    expect(localStorage.getItem('dashboard-theme')).toBe(JSON.stringify({ state: { theme: 'slate' }, version: 0 }));
  });
});

describe('backup coverage', () => {
  it('includes the crypto watchlist, which is not dashboard-* prefixed', async () => {
    localStorage.setItem('crypto-watchlist', JSON.stringify({ state: { ids: ['bitcoin'] }, version: 0 }));
    expect(buildBackupPayload().data['crypto-watchlist']).toEqual({ state: { ids: ['bitcoin'] }, version: 0 });
    localStorage.clear();
    await importSettings(backupFile({ app: 'nishboard', version: 1, data: { 'crypto-watchlist': { state: { a: 1 }, version: 0 } } }));
    expect(localStorage.getItem('crypto-watchlist')).toBe(JSON.stringify({ state: { a: 1 }, version: 0 }));
  });

  it('excludes the Claude transcript and palette recents from export and import', async () => {
    localStorage.setItem('dashboard-claude', JSON.stringify({ state: { messages: ['secret'] } }));
    localStorage.setItem('dashboard-palette-recents', JSON.stringify(['a']));
    localStorage.setItem('dashboard-theme', '{}');
    const payload = buildBackupPayload();
    expect('dashboard-claude' in payload.data).toBe(false);
    expect('dashboard-palette-recents' in payload.data).toBe(false);
    expect('dashboard-theme' in payload.data).toBe(true);

    localStorage.clear();
    await importSettings(
      backupFile({ app: 'nishboard', version: 1, data: { 'dashboard-claude': { x: 1 }, 'dashboard-palette-recents': ['b'] } }),
    );
    expect(localStorage.getItem('dashboard-claude')).toBeNull();
    expect(localStorage.getItem('dashboard-palette-recents')).toBeNull();
  });

  it('covers every persisted store name except the excluded ones', () => {
    // Hard-coded from `git grep -n "name: '" -- apps/renderer/src/store` (persist
    // names only). Add a new persisted store here; the test then proves backup
    // covers it, or that it is deliberately excluded.
    const persistNames = [
      'dashboard-alerts', 'dashboard-claude', 'dashboard-countdown', 'crypto-watchlist',
      'dashboard-discord-ui', 'hardware-config', 'dashboard-inbox-ui', 'dashboard-launcher-ui',
      'dashboard-layout', 'dashboard-netmon', 'dashboard-notes', 'dashboard-app-settings',
      'dashboard-tasks', 'dashboard-theme', 'dashboard-timers', 'dashboard-widget-ui',
      'dashboard-worldclock',
    ];
    for (const name of persistNames) localStorage.setItem(name, '{}');
    const keys = Object.keys(buildBackupPayload().data);
    expect(persistNames.filter((n) => !keys.includes(n))).toEqual(['dashboard-claude']);
  });
});
