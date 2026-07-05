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
    expect(localStorage.getItem('stocks-watchlist')).toBe(JSON.stringify(['AAPL']));
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
    localStorage.setItem('stocks-watchlist', JSON.stringify(['SPY']));
    localStorage.setItem('unrelated', 'x');

    const payload = buildBackupPayload();
    expect(payload.app).toBe('nishboard');
    expect(payload.version).toBe(1);
    expect(payload.data['dashboard-app-settings']).toEqual({ state: {}, version: 1 });
    expect(payload.data['dashboard-future-widget']).toEqual({ a: 1 });
    expect(payload.data['stocks-watchlist']).toEqual(['SPY']);
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
