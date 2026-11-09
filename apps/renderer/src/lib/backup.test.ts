import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackupPayload, importSettings } from './backup';

function backupFile(payload: unknown): File {
  return new File([JSON.stringify(payload)], 'settings.json', { type: 'application/json' });
}

beforeEach(() => {
  localStorage.clear();
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

  it('writes string values verbatim', async () => {
    await importSettings(backupFile({ app: 'nishboard', version: 1, data: { 'dashboard-notes': 'raw-string' } }));
    expect(localStorage.getItem('dashboard-notes')).toBe('raw-string');
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
    await importSettings(backupFile({ app: 'nishboard', version: 1, data: { 'crypto-watchlist': { a: 1 } } }));
    expect(localStorage.getItem('crypto-watchlist')).toBe(JSON.stringify({ a: 1 }));
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
