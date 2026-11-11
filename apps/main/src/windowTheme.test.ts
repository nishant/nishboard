import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DEFAULT_WINDOW_BG, parseWindowTheme } from './windowTheme';

describe('parseWindowTheme', () => {
  it('accepts system/light/dark with a #rrggbb background', () => {
    expect(parseWindowTheme('system', '#0A0B0F')).toEqual({ source: 'system', bg: '#0a0b0f' });
    expect(parseWindowTheme('light', '#f7f6f3')).toEqual({ source: 'light', bg: '#f7f6f3' });
    expect(parseWindowTheme('dark', '#000000')).toEqual({ source: 'dark', bg: '#000000' });
  });

  it('rejects anything else from the renderer', () => {
    expect(parseWindowTheme('ocean', '#000000')).toBeNull();
    expect(parseWindowTheme('dark', 'rgb(0,0,0)')).toBeNull();
    expect(parseWindowTheme('dark', '#000')).toBeNull();
    expect(parseWindowTheme(undefined, undefined)).toBeNull();
  });
});

describe('setWindowTheme', () => {
  let dir: string;
  let nativeTheme: typeof import('electron').nativeTheme;
  let readWindowTheme: typeof import('./windowTheme').readWindowTheme;
  let setWindowTheme: typeof import('./windowTheme').setWindowTheme;

  // windowTheme.ts caches the theme at module scope and writes to userData, so
  // every test gets its own temp dir and a freshly imported module.
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nishboard-theme-'));
    vi.resetModules();
    // Re-import electron too: resetModules gives windowTheme a fresh stub, and
    // the spy and nativeTheme assertions must target that same instance.
    const electron = await import('electron');
    nativeTheme = electron.nativeTheme;
    vi.spyOn(electron.app, 'getPath').mockReturnValue(dir);
    ({ readWindowTheme, setWindowTheme } = await import('./windowTheme'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts from system and the shared dark background', () => {
    expect(readWindowTheme()).toEqual({ source: 'system', bg: DEFAULT_WINDOW_BG });
  });

  it('keeps the system choice as system (never the resolved scheme)', () => {
    setWindowTheme('light', '#f7f6f3');
    expect(nativeTheme.themeSource).toBe('light');
    setWindowTheme('system', '#0a0b0f');
    expect(nativeTheme.themeSource).toBe('system');
    expect(readWindowTheme()).toEqual({ source: 'system', bg: '#0a0b0f' });
  });

  it('ignores an invalid payload', () => {
    setWindowTheme('dark', '#111111');
    setWindowTheme('bogus', '#ffffff');
    expect(nativeTheme.themeSource).toBe('dark');
    expect(readWindowTheme().bg).toBe('#111111');
  });
});
