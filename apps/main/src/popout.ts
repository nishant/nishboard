import { BrowserWindow, app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

// Pop-out widget windows: each widget can float in its own small frameless
// window loading the same renderer bundle with ?widget=<id> (the renderer
// entry branches to PopoutShell). Window bounds persist per widget in
// userData/popouts.json (prefs.ts pattern) so a popout reopens where it lived.

const isDev = process.env.NODE_ENV === 'development';

interface StoredBounds { x: number; y: number; width: number; height: number }
type PopoutBoundsFile = Partial<Record<string, StoredBounds>>;

// Per-widget default sizes — roughly each widget's comfortable minimum tile.
const DEFAULT_SIZES: Record<string, { width: number; height: number }> = {
  weather: { width: 340, height: 380 },
  spotify: { width: 340, height: 430 },
  stocks: { width: 380, height: 420 },
  hardware: { width: 430, height: 380 },
  sound: { width: 320, height: 300 },
  calendar: { width: 320, height: 340 },
  youtube: { width: 480, height: 360 },
  twitch: { width: 480, height: 360 },
  tasks: { width: 300, height: 340 },
  worldclock: { width: 300, height: 260 },
  notes: { width: 380, height: 420 },
  timer: { width: 300, height: 280 },
  countdown: { width: 320, height: 260 },
  news: { width: 420, height: 220 },
  crypto: { width: 360, height: 380 },
  launcher: { width: 360, height: 380 },
  clipboard: { width: 340, height: 400 },
};
const FALLBACK_SIZE = { width: 360, height: 320 };

const popouts = new Map<string, BrowserWindow>();

function boundsPath(): string {
  return path.join(app.getPath('userData'), 'popouts.json');
}

function readBoundsFile(): PopoutBoundsFile {
  try {
    if (existsSync(boundsPath())) {
      return JSON.parse(readFileSync(boundsPath(), 'utf8')) as PopoutBoundsFile;
    }
  } catch { /* corrupted → start fresh */ }
  return {};
}

function persistBounds(id: string, bounds: StoredBounds): void {
  try {
    const file = readBoundsFile();
    file[id] = bounds;
    writeFileSync(boundsPath(), JSON.stringify(file), 'utf8');
  } catch { /* non-fatal — popout just reopens at the default spot */ }
}

/** Ids of currently open popouts (renderer syncs its store from this). */
export function openPopoutIds(): string[] {
  return [...popouts.keys()];
}

function broadcast(): void {
  const ids = openPopoutIds();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('popout:changed', ids);
  }
}

export function openPopout(id: string): void {
  const existing = popouts.get(id);
  if (existing) {
    existing.show();
    existing.focus();
    return;
  }

  const stored = readBoundsFile()[id];
  const size = DEFAULT_SIZES[id] ?? FALLBACK_SIZE;
  // Windows: transparent frameless window so the renderer rounds its own
  // corners, matching the main window (see createWindow in index.ts).
  const isWin = process.platform === 'win32';

  const win = new BrowserWindow({
    width: stored?.width ?? size.width,
    height: stored?.height ?? size.height,
    x: stored?.x,
    y: stored?.y,
    minWidth: 220,
    minHeight: 160,
    frame: false,
    resizable: true,
    ...(isWin
      ? { transparent: true, backgroundColor: '#00000000' }
      : { backgroundColor: '#09090b' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Popouts host the same third-party embeds as the main window — same guards.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  if (isDev) {
    void win.loadURL(`http://localhost:5173/?widget=${encodeURIComponent(id)}`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/dist/index.html'), {
      query: { widget: id },
    });
  }

  win.on('close', () => {
    persistBounds(id, win.getBounds());
  });
  win.on('closed', () => {
    popouts.delete(id);
    broadcast();
  });

  popouts.set(id, win);
  broadcast();
}

export function closePopout(id: string): void {
  popouts.get(id)?.close();
}

/** Close every popout — called when the main window truly closes so a
 *  quitting app doesn't leave orphaned floaters. */
export function closeAllPopouts(): void {
  for (const win of [...popouts.values()]) win.close();
}
