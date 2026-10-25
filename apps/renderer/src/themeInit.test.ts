/// <reference types="vite/client" />
// The pre-paint script as vite.config.ts builds it: Nishboard's prelude, then
// @nish/ui's theme-init.js.
import { beforeEach, describe, expect, it } from 'vitest';
import appInit from './theme-init-app.js?raw';
import sharedInit from '@nish/ui/theme-init.js?raw';
import { APP_PRESETS } from './lib/appPresets';
import { LEGACY_THEME_IDS } from './lib/legacyThemes';

const script =
  appInit
    .replace('__APP__', JSON.stringify(Object.fromEntries(APP_PRESETS.map((p) => [p.id, p.base.scheme]))))
    .replace('__LEGACY__', JSON.stringify(LEGACY_THEME_IDS)) +
  '\n' +
  sharedInit;

function run(saved: Record<string, unknown>) {
  for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, JSON.stringify(v));
  new Function(script)();
  const root = document.documentElement;
  return { theme: root.getAttribute('data-theme'), scheme: root.getAttribute('data-scheme'), root };
}

describe('pre-paint theme init', () => {
  beforeEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute('data-theme');
    root.removeAttribute('style');
  });

  it('maps a pre-@nish/ui id (store version 0)', () => {
    expect(run({ 'dashboard-theme': { state: { theme: 'midnight' }, version: 0 } })).toMatchObject({ theme: 'dark', scheme: 'dark' });
    localStorage.clear();
    expect(run({ 'dashboard-theme': { state: { theme: 'slate' }, version: 0 } })).toMatchObject({ theme: 'light', scheme: 'light' });
  });

  it('keeps a shared preset id from version 1', () => {
    expect(run({ 'dashboard-theme': { state: { theme: 'slate' }, version: 1 } })).toMatchObject({ theme: 'slate', scheme: 'dark' });
  });

  it('applies an app-local preset with its scheme', () => {
    expect(run({ 'dashboard-theme': { state: { theme: 'solarized' }, version: 1 } })).toMatchObject({ theme: 'solarized', scheme: 'light' });
    expect(window.__nishExtraThemes?.rose).toBe('dark');
  });

  it('applies the Custom colors and scheme', () => {
    const out = run({
      'dashboard-theme': { state: { theme: 'custom' }, version: 1 },
      'dashboard-theme-custom-vars': { scheme: 'light', vars: { '--nish-bg': '#fafafa' } },
    });
    expect(out).toMatchObject({ theme: 'custom', scheme: 'light' });
    expect(out.root.style.getPropertyValue('--nish-bg')).toBe('#fafafa');
  });

  it('falls back to the OS choice with nothing saved', () => {
    expect(run({}).theme).toBe('dark');
  });
});
