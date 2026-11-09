import { app } from 'electron';
import { APP_ORIGIN } from './appProtocol';

/** True only in a dev run (`pnpm dev`): an unpackaged app with NODE_ENV=development.
 *  A function, not a constant, so tests that stub NODE_ENV per test still work.
 *  The isPackaged check means a stray NODE_ENV=development in a user's
 *  environment cannot switch a packaged build into dev mode (a fixed API token
 *  file, no app:// protocol, no port cleanup). */
export function isDev(): boolean {
  return !app.isPackaged && process.env.NODE_ENV === 'development';
}

/** `scheme://host[:port]` of a URL, or null if it does not parse. URL.origin is
 *  the string "null" for a custom scheme like app://, so build it by hand. */
export function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Whether the top frame may navigate to `url`. In dev: the Vite server. In
 *  production: only the renderer page itself (app://nishboard/index.html, query
 *  string allowed), never another app:// path such as a relative link in a
 *  note, which would land the frameless window on the 404 page. */
export function isAllowedNavigation(url: string, dev: boolean): boolean {
  const origin = originOf(url);
  if (origin === null) return false;
  if (dev) return origin === 'http://localhost:5173';
  return origin === APP_ORIGIN && new URL(url).pathname === '/index.html';
}
