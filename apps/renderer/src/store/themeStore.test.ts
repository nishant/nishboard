import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEMES as NISH_THEMES } from '@nish/ui';
import { APP_PRESETS } from '../lib/appPresets';
import { deriveThemeColors, contrast } from '../lib/themeVars';
import { THEMES, migrateThemeId } from '../themes';

// Same pattern as settingsStore.test.ts: seed storage, then import a fresh module.
async function loadStore() {
  const mod = await import('./themeStore');
  return mod.useThemeStore;
}

function seed(theme: string, version: number) {
  localStorage.setItem('dashboard-theme', JSON.stringify({ state: { theme }, version }));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('dashboard-theme v0 → v1 migration (themes moved onto @nish/ui)', () => {
  it.each([
    ['midnight', 'dark'],
    ['slate', 'light'], // slate was LIGHT here; the shared slate is a dark theme
    ['ocean', 'ocean'],
    ['contrast', 'contrast'],
    ['mocha', 'mocha'],
    ['nord', 'nord'],
    ['solarized', 'solarized'],
    ['custom', 'custom'],
    ['not-a-theme', 'dark'],
  ])('%s → %s', async (from, to) => {
    seed(from, 0);
    const store = await loadStore();
    expect(store.getState().theme).toBe(to);
  });

  it('leaves v1 state alone: slate now means the shared dark slate', async () => {
    seed('slate', 1);
    const store = await loadStore();
    expect(store.getState().theme).toBe('slate');
  });

  it('adopts an existing @nish/ui choice on first run', async () => {
    localStorage.setItem('nish-theme', 'light');
    const store = await loadStore();
    expect(store.getState().theme).toBe('light');
  });

  it('follows the OS with nothing saved', async () => {
    const store = await loadStore();
    expect(store.getState().theme).toBe('system');
  });

  it.each(['dark', 'light', 'rose', 'custom'])('keeps a saved v1 %s', async (theme) => {
    seed(theme, 1);
    localStorage.setItem('nish-theme', 'system');
    const store = await loadStore();
    expect(store.getState().theme).toBe(theme);
  });
});

describe('theme list', () => {
  it('offers system, every shared theme, every app preset and custom, once each', () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('system');
    expect(ids).toContain('custom');
    for (const id of Object.keys(NISH_THEMES)) expect(ids).toContain(id);
    for (const p of APP_PRESETS) expect(ids).toContain(p.id);
  });

  it('no app preset shadows a shared theme id', () => {
    for (const p of APP_PRESETS) expect(Object.keys(NISH_THEMES)).not.toContain(p.id);
  });

  it('migrateThemeId passes current ids through (except slate, which v0 used for light)', () => {
    for (const t of THEMES) if (t.id !== 'slate') expect(migrateThemeId(t.id)).toBe(t.id);
  });
});

describe('app presets', () => {
  it.each(APP_PRESETS.map((p) => [p.id, p] as const))('%s keeps text readable on its panels', (_id, preset) => {
    const c = deriveThemeColors(preset.base);
    for (const role of ['hi', 'hi2', 'hi3', 'accent', 'ok', 'loss', 'warn', 'info'] as const) {
      expect(contrast(c[role], c.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c[role], c.elevated)).toBeGreaterThanOrEqual(4.5);
    }
    for (const r of ['ok', 'loss', 'warn', 'info'] as const) {
      expect(contrast(c[`on-${r}`], c[`${r}-fill`])).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(c['on-accent2'], c.accent2)).toBeGreaterThanOrEqual(4.5);
  });
});
