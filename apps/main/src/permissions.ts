import type { Session } from 'electron';
import { APP_ORIGIN } from './appProtocol';
import { isDev, originOf } from './env';

// Electron grants every permission request when a session has no handler. The
// default session hosts the privileged renderer, the popouts and third-party
// embeds, so it gets an allowlist: the renderer needs only
// clipboard-sanitized-write (navigator.clipboard.writeText) and fullscreen
// (embed iframes). Native notifications go through IPC (window.electron.notify)
// and links through app:open-external, so 'notifications' and 'openExternal'
// stay denied. The persist:discord partition has its own handlers (discord.ts).

const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

const DEV_ORIGIN = 'http://localhost:5173';
const LOCAL_ORIGINS = ['http://localhost:7432', 'http://127.0.0.1:7432'];
const EMBED_HOSTS = ['www.youtube-nocookie.com', 'player.twitch.tv', 'clips.twitch.tv', 'www.rainviewer.com'];

/** Pure decision for the default session. `dev` allows the Vite origin. */
export function decideDefaultPermission(
  permission: string,
  requestingUrl: string | undefined,
  dev: boolean,
): boolean {
  if (!ALLOWED_PERMISSIONS.has(permission)) return false;
  const origin = originOf(requestingUrl);
  if (origin === null) return false;
  if (origin === APP_ORIGIN) return true;
  if (dev && origin === DEV_ORIGIN) return true;
  if (LOCAL_ORIGINS.includes(origin)) return true;
  return EMBED_HOSTS.some((h) => origin === `https://${h}`);
}

/** Deny-by-default permission handlers for the default session. */
export function installDefaultPermissionHandlers(ses: Session): void {
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(decideDefaultPermission(permission, details.requestingUrl || webContents.getURL(), isDev()));
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    decideDefaultPermission(permission, requestingOrigin, isDev()));
}
