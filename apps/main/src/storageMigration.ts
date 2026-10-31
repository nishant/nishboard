import { app, BrowserWindow, session } from 'electron';
import fs from 'fs';
import path from 'path';
import { APP_ORIGIN, BLANK_PATH } from './appProtocol';

const MARKER = 'storage-origin.json';
const TIMEOUT_MS = 10_000;

/** Validates what the file:// page handed back. Exported for tests. */
export function parseEntries(dump: unknown): Array<[string, string]> {
  if (typeof dump !== 'string') return [];
  const parsed: unknown = JSON.parse(dump);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is [string, string] => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'string',
  );
}

/** The script that writes `entries` on the app origin. The file:// value wins
 *  over anything already there: with no marker, app:// is either empty (first
 *  launch) or holds the defaults a renderer saved after a failed copy, never
 *  the user's real state. JSON is valid JavaScript, so the data needs no
 *  escaping. Exported for tests. */
export function writeScript(entries: Array<[string, string]>): string {
  return `(() => { let n = 0; for (const [k, v] of ${JSON.stringify(entries)}) { localStorage.setItem(k, v); n++; } return n; })()`;
}

async function copyFileOriginStorage(win: BrowserWindow): Promise<number> {
  const blankFile = path.join(app.getPath('userData'), 'storage-migration.html');
  try {
    // Every file:// page shares one origin, so any file reads the old storage.
    fs.writeFileSync(blankFile, '<!doctype html><title></title>');
    await win.loadFile(blankFile);
    const entries = parseEntries(await win.webContents.executeJavaScript('JSON.stringify(Object.entries(localStorage))'));
    if (entries.length === 0) return 0;
    await win.loadURL(`${APP_ORIGIN}${BLANK_PATH}`);
    await win.webContents.executeJavaScript(writeScript(entries));
    session.defaultSession.flushStorageData();
    return entries.length;
  } finally {
    fs.rmSync(blankFile, { force: true });
  }
}

/** One time, before the first app:// window: copy the renderer's localStorage
 *  (layouts, notes, tasks, theme, every persisted store) from the old file://
 *  origin to app://nishboard, file:// values winning. The old copy stays where it is. A failure is
 *  logged and retried next launch; it never blocks startup. */
export async function migrateFileOriginStorage(): Promise<void> {
  const marker = path.join(app.getPath('userData'), MARKER);
  if (fs.existsSync(marker)) return;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const copied = await Promise.race([
      copyFileOriginStorage(win),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS);
      }),
    ]);
    fs.writeFileSync(marker, JSON.stringify({ origin: APP_ORIGIN, from: 'file://', keys: copied, at: new Date().toISOString() }));
    console.log(`[storage] copied ${copied} localStorage keys from file:// to ${APP_ORIGIN}`);
  } catch (err) {
    console.error('[storage] could not copy localStorage from file:// (retrying next launch):', err);
  } finally {
    clearTimeout(timer);
    // Destroyed here, not in the copy, so a timed-out copy cannot keep writing
    // after the dashboard has loaded.
    win.destroy();
  }
}
