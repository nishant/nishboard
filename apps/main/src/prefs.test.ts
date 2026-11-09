import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.resetModules() gives the stub a fresh userData dir; beforeEach records it.
let dir = '';
const file = (): string => path.join(dir, 'prefs.json');

describe('prefs', () => {
  beforeEach(async () => {
    vi.resetModules();
    dir = (await import('electron')).app.getPath('userData'); // prefs caches in module memory
    fs.rmSync(file(), { force: true });
  });
  afterEach(() => {
    fs.rmSync(file(), { force: true });
  });

  it('starts from the defaults', async () => {
    const { readPrefs } = await import('./prefs');
    expect(readPrefs()).toEqual({ closeAction: 'quit', globalHotkey: false, backupDir: null });
  });

  it('accepts valid values and persists them', async () => {
    const { writePrefs } = await import('./prefs');
    const next = writePrefs({ closeAction: 'tray', globalHotkey: true, backupDir: 'D:\backups' });
    expect(next).toEqual({ closeAction: 'tray', globalHotkey: true, backupDir: 'D:\backups' });
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual(next);
  });

  it('rejects bad values and keeps the current ones', async () => {
    const { writePrefs } = await import('./prefs');
    writePrefs({ closeAction: 'tray', globalHotkey: true, backupDir: 'X' });
    const bad = { closeAction: 'explode', globalHotkey: 'yes', backupDir: 42 } as never;
    expect(writePrefs(bad)).toEqual({ closeAction: 'tray', globalHotkey: true, backupDir: 'X' });
  });

  it('turns an empty backupDir into null', async () => {
    const { writePrefs } = await import('./prefs');
    writePrefs({ backupDir: 'X' });
    expect(writePrefs({ backupDir: '' }).backupDir).toBeNull();
  });

  it('sanitises a hand-edited file on read', async () => {
    fs.writeFileSync(file(), JSON.stringify({ closeAction: 'bogus', globalHotkey: 'true', backupDir: 7 }));
    const { readPrefs } = await import('./prefs');
    expect(readPrefs()).toEqual({ closeAction: 'quit', globalHotkey: false, backupDir: null });
  });
});
