import { describe, expect, it } from 'vitest';
import { nativeTheme } from 'electron';
import { DEFAULT_WINDOW_BG, parseWindowTheme, readWindowTheme, setWindowTheme } from './windowTheme';

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
