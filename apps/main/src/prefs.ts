import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import type { AppPrefsData } from '@dash/shared';

// Main-side prefs (userData/prefs.json), NOT renderer localStorage: the close
// intercept and global-hotkey registration must be readable before the
// renderer has loaded a single byte.

const DEFAULTS: AppPrefsData = {
  closeAction: 'quit',
  globalHotkey: false,
};

function prefsPath(): string {
  return path.join(app.getPath('userData'), 'prefs.json');
}

let cached: AppPrefsData | null = null;

export function readPrefs(): AppPrefsData {
  if (cached) return cached;
  try {
    if (existsSync(prefsPath())) {
      const raw = JSON.parse(readFileSync(prefsPath(), 'utf8')) as Partial<AppPrefsData>;
      cached = {
        closeAction: raw.closeAction === 'tray' ? 'tray' : 'quit',
        globalHotkey: raw.globalHotkey === true,
      };
      return cached;
    }
  } catch { /* fall through to defaults */ }
  cached = { ...DEFAULTS };
  return cached;
}

export function writePrefs(patch: Partial<AppPrefsData>): AppPrefsData {
  const next: AppPrefsData = {
    ...readPrefs(),
    ...(patch.closeAction === 'tray' || patch.closeAction === 'quit' ? { closeAction: patch.closeAction } : {}),
    ...(typeof patch.globalHotkey === 'boolean' ? { globalHotkey: patch.globalHotkey } : {}),
  };
  cached = next;
  writeFileSync(prefsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
