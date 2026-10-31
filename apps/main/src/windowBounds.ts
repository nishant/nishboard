import { app, screen } from 'electron';
import type { BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

// Main-window bounds (userData/window-bounds.json, prefs.ts pattern) plus the
// display clamping shared by the main window and every popout, so a window
// never reopens on a monitor that has been unplugged.

export interface Rect { x: number; y: number; width: number; height: number }
export interface SavedBounds extends Rect { maximized: boolean }

const MIN_OVERLAP = 64;
const SAVE_DEBOUNCE_MS = 500;

function overlapOf(r: Rect, a: Rect): { w: number; h: number } {
  const w = Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x);
  const h = Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y);
  return { w, h };
}

/** Pure: keep `r` if at least 64×64 px of it overlaps some work area; otherwise centre it
 *  on `fallback` (the primary work area). Always shrink width/height to fit the chosen
 *  work area. Exported for tests. */
export function clampToDisplays(r: Rect, workAreas: Rect[], fallback: Rect): Rect {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const a of workAreas) {
    const { w, h } = overlapOf(r, a);
    if (w >= MIN_OVERLAP && h >= MIN_OVERLAP && w * h > bestArea) {
      best = a;
      bestArea = w * h;
    }
  }

  if (!best) {
    const width = Math.min(r.width, fallback.width);
    const height = Math.min(r.height, fallback.height);
    return {
      x: Math.round(fallback.x + (fallback.width - width) / 2),
      y: Math.round(fallback.y + (fallback.height - height) / 2),
      width,
      height,
    };
  }

  const width = Math.min(r.width, best.width);
  const height = Math.min(r.height, best.height);
  if (width === r.width && height === r.height) return { ...r };
  // Shrunk to fit: pull the position inside the work area too.
  return {
    x: Math.min(Math.max(r.x, best.x), best.x + best.width - width),
    y: Math.min(Math.max(r.y, best.y), best.y + best.height - height),
    width,
    height,
  };
}

function boundsPath(): string {
  return path.join(app.getPath('userData'), 'window-bounds.json');
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Exported for tests. Validate the parsed file field by field. */
export function parseMainBounds(raw: unknown): SavedBounds | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const main = (raw as { main?: unknown }).main;
  if (typeof main !== 'object' || main === null) return null;
  const m = main as Record<string, unknown>;
  if (
    !isFiniteNumber(m.x) || !isFiniteNumber(m.y) ||
    !isFiniteNumber(m.width) || !isFiniteNumber(m.height) ||
    m.width < 360 || m.height < 400
  ) return null;
  return { x: m.x, y: m.y, width: m.width, height: m.height, maximized: m.maximized === true };
}

export function readMainBounds(): SavedBounds | null {
  try {
    if (!existsSync(boundsPath())) return null;
    return parseMainBounds(JSON.parse(readFileSync(boundsPath(), 'utf8')) as unknown);
  } catch {
    return null;
  }
}

function writeMainBounds(b: SavedBounds): void {
  try {
    writeFileSync(boundsPath(), JSON.stringify({ main: b }), 'utf8');
  } catch { /* non-fatal — window just reopens at the default spot */ }
}

export function trackMainBounds(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = (): void => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const n = win.getNormalBounds();
    writeMainBounds({ x: n.x, y: n.y, width: n.width, height: n.height, maximized: win.isMaximized() });
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  // A window hidden in the tray can outlive its monitor; re-check when it comes back.
  win.on('show', () => ensureOnScreen(win));
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    timer = null;
    save();
  });
}

function currentWorkAreas(): { areas: Rect[]; primary: Rect } {
  return {
    areas: screen.getAllDisplays().map((d) => d.workArea),
    primary: screen.getPrimaryDisplay().workArea,
  };
}

/** Screen-aware clamp for a rect about to become a window. */
export function clampToScreen(r: Rect): Rect {
  const { areas, primary } = currentWorkAreas();
  return clampToDisplays(r, areas, primary);
}

export function ensureOnScreen(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return; // hidden windows too: setBounds works while hidden (tray)
  const cur = win.getBounds();
  const next = clampToScreen(cur);
  if (next.x !== cur.x || next.y !== cur.y || next.width !== cur.width || next.height !== cur.height) {
    win.setBounds(next);
  }
}

let watching = false;

export function watchDisplays(getWindows: () => BrowserWindow[]): void {
  if (watching) return;
  watching = true;
  const fix = (): void => {
    for (const w of getWindows()) ensureOnScreen(w);
  };
  screen.on('display-removed', fix);
  screen.on('display-metrics-changed', fix);
}
