import { app, BrowserWindow, nativeTheme } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import type { NativeThemeSource } from '@dash/shared';

// Native theme sync (both platforms). The renderer reports its theme choice on
// every change (`app:set-theme`):
// - nativeTheme.themeSource follows it, so native chrome (scrollbars, context
//   menus, the Discord <webview>'s prefers-color-scheme) matches. 'system' stays
//   'system': forcing the resolved scheme would pin prefers-color-scheme in every
//   renderer and @nish/ui's system watcher would never see the OS flip.
// - every window's backgroundColor becomes the theme's --nish-bg, and the value is
//   saved (userData/window-theme.json) so the next launch paints the right color
//   before the renderer loads (no dark flash on a light theme, and resizes fill
//   with the theme color on the opaque Windows window).
// Packaged-build behavior; `pnpm dev` only shows it partly.

/** @nish/ui dark's --nish-bg: the launch color until a theme has been saved. */
export const DEFAULT_WINDOW_BG = '#0a0b0f';

export interface WindowTheme {
  source: NativeThemeSource;
  bg: string;
}

const HEX = /^#[0-9a-f]{6}$/i;

function isSource(v: unknown): v is NativeThemeSource {
  return v === 'system' || v === 'light' || v === 'dark';
}

/** Validates an IPC/disk payload; null when it is not a usable theme. Exported for tests. */
export function parseWindowTheme(source: unknown, bg: unknown): WindowTheme | null {
  if (!isSource(source)) return null;
  if (typeof bg !== 'string' || !HEX.test(bg)) return null;
  return { source, bg: bg.toLowerCase() };
}

function themePath(): string {
  return path.join(app.getPath('userData'), 'window-theme.json');
}

let cached: WindowTheme | null = null;

/** The saved theme, or system + the default background. */
export function readWindowTheme(): WindowTheme {
  if (cached) return cached;
  try {
    if (existsSync(themePath())) {
      const raw = JSON.parse(readFileSync(themePath(), 'utf8')) as { source?: unknown; bg?: unknown };
      const parsed = parseWindowTheme(raw.source, raw.bg);
      if (parsed) return (cached = parsed);
    }
  } catch { /* fall through to the default */ }
  return (cached = { source: 'system', bg: DEFAULT_WINDOW_BG });
}

/** Applies the saved source at startup (before any window exists). */
export function initNativeTheme(): void {
  nativeTheme.themeSource = readWindowTheme().source;
}

/** Applies a theme reported by a renderer to every window and saves it.
 *  `skip` leaves a window's background alone (the transparent Windows popouts,
 *  which must keep their #00000000 background). */
export function setWindowTheme(source: unknown, bg: unknown, skip: (win: BrowserWindow) => boolean = () => false): void {
  const next = parseWindowTheme(source, bg);
  if (!next) return;
  const prev = readWindowTheme();
  if (nativeTheme.themeSource !== next.source) nativeTheme.themeSource = next.source;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !skip(win)) win.setBackgroundColor(next.bg);
  }
  if (prev.source === next.source && prev.bg === next.bg) return;
  cached = next;
  try {
    writeFileSync(themePath(), JSON.stringify(next, null, 2), 'utf8');
  } catch { /* the in-memory value still applies for this run */ }
}
