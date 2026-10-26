import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@dash/shared';
import { syncNativeTheme } from './appTheme';

describe('syncNativeTheme', () => {
  const setNativeTheme = vi.fn();

  beforeEach(() => {
    setNativeTheme.mockReset();
    window.electron = { setNativeTheme } as Partial<ElectronAPI> as ElectronAPI;
    document.documentElement.style.setProperty('--nish-bg', '#f7f6f3');
  });

  afterEach(() => {
    window.electron = undefined;
    document.documentElement.style.removeProperty('--nish-bg');
  });

  it("sends 'system' for the system choice, not the resolved scheme", () => {
    syncNativeTheme('system');
    expect(setNativeTheme).toHaveBeenCalledWith('system', '#f7f6f3');
  });

  it("sends the theme's scheme and background for a fixed choice", () => {
    syncNativeTheme('light');
    expect(setNativeTheme).toHaveBeenCalledWith('light', '#f7f6f3');
    syncNativeTheme('ocean');
    expect(setNativeTheme).toHaveBeenLastCalledWith('dark', '#f7f6f3');
  });

  it('does nothing outside Electron', () => {
    window.electron = undefined;
    expect(() => syncNativeTheme('dark')).not.toThrow();
  });
});
