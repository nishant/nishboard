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

/** The script that writes `entries` on the app origin. By default the file://
 *  value wins over anything already there: with no marker, app:// is empty
 *  (first launch). With `fillOnly` an existing app:// value is kept and only
 *  missing keys are written: used when an earlier attempt already reached the
 *  app origin, after which a session may have changed keys there that the old
 *  file:// copy must not revert. JSON is valid JavaScript, so the data needs no
 *  escaping. Exported for tests. */
export function writeScript(entries: Array<[string, string]>, opts: { fillOnly?: boolean } = {}): string {
  const set = opts.fillOnly
    ? 'if (localStorage.getItem(k) === null) { localStorage.setItem(k, v); n++; }'
    : 'localStorage.setItem(k, v); n++;';
  return `(() => { let n = 0; for (const [k, v] of ${JSON.stringify(entries)}) { ${set} } return n; })()`;
}

/** What the marker file says. 'attempted' is written just before the copy
 *  writes to app://, so a retry knows app:// may already hold newer data. A
 *  marker from before this field existed counts as 'done'. */
type MarkerState = 'attempted' | 'done';

function readMarkerState(marker: string): MarkerState | null {
  if (!fs.existsSync(marker)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && (parsed as { state?: unknown }).state === 'attempted') {
      return 'attempted';
    }
  } catch {
    // unreadable marker: treat as an old, finished one
  }
  return 'done';
}

async function copyFileOriginStorage(win: BrowserWindow, marker: string, fillOnly: boolean): Promise<number> {
  const blankFile = path.join(app.getPath('userData'), 'storage-migration.html');
  try {
    // Every file:// page shares one origin, so any file reads the old storage.
    fs.writeFileSync(blankFile, '<!doctype html><title></title>');
    await win.loadFile(blankFile);
    const entries = parseEntries(await win.webContents.executeJavaScript('JSON.stringify(Object.entries(localStorage))'));
    if (entries.length === 0) return 0;
    await win.loadURL(`${APP_ORIGIN}${BLANK_PATH}`);
    // Recorded before the write: if it fails or times out part-way, the next
    // launch must not let file:// values overwrite what a session changed.
    fs.writeFileSync(marker, JSON.stringify({ state: 'attempted', origin: APP_ORIGIN, from: 'file://', at: new Date().toISOString() }));
    await win.webContents.executeJavaScript(writeScript(entries, { fillOnly }));
    session.defaultSession.flushStorageData();
    return entries.length;
  } finally {
    fs.rmSync(blankFile, { force: true });
  }
}

/** One time, before the first app:// window: copy the renderer's localStorage
 *  (layouts, notes, tasks, theme, every persisted store) from the old file://
 *  origin to app://nishboard, file:// values winning on the first attempt. The
 *  old copy stays where it is. A failure is logged and retried next launch; a
 *  retry after an attempt reached app:// only fills keys that are missing there
 *  (the marker's 'attempted' state). It never blocks startup. */
export async function migrateFileOriginStorage(): Promise<void> {
  const marker = path.join(app.getPath('userData'), MARKER);
  const previous = readMarkerState(marker);
  if (previous === 'done') return;
  const fillOnly = previous === 'attempted';
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const copied = await Promise.race([
      copyFileOriginStorage(win, marker, fillOnly),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS);
      }),
    ]);
    fs.writeFileSync(marker, JSON.stringify({ state: 'done', origin: APP_ORIGIN, from: 'file://', keys: copied, at: new Date().toISOString() }));
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
