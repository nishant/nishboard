import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IpcMain, IpcMainEvent } from 'electron';
import type { IpcChannels } from '@dash/shared';
import { APP_ORIGIN } from './appProtocol';

const isDev = process.env.NODE_ENV === 'development';
const DEV_ORIGIN = 'http://localhost:5173';

let token: string | null = null;

/** `pnpm dev` starts the server through concurrently, so main and server meet
 *  at a token file (packages/server/src/index.ts holds the other half):
 *  whichever starts first creates it, the other reads it. */
function devToken(): string {
  const file = path.join(os.homedir(), '.dash', 'dev-api-token');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (!(err instanceof Error && 'code' in err && err.code === 'EEXIST')) throw err;
  }
  return fs.readFileSync(file, 'utf8').trim();
}

/** The bearer token for the local server: random per launch in a packaged
 *  build, handed to the server as env DASH_API_TOKEN (server/spawn.ts) and to
 *  the renderer over IPC (preload.ts). A web page in a browser has neither. */
export function apiToken(): string {
  token ??= isDev ? devToken() : randomBytes(32).toString('base64url');
  return token;
}

/** Only our own renderer's top frame gets the token: an iframe (YouTube,
 *  Twitch, the radar) has no preload, and a window that navigated elsewhere
 *  is refused by its origin. */
function trustedSender(event: IpcMainEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  try {
    // Not URL.origin: Node's WHATWG URL reports "null" for a non-special
    // scheme such as app:, whatever Chromium registered.
    const url = new URL(frame.url);
    const origin = `${url.protocol}//${url.host}`;
    return origin === APP_ORIGIN || (isDev && origin === DEV_ORIGIN);
  } catch {
    return false;
  }
}

export function registerApiTokenIpc(ipcMain: IpcMain): void {
  ipcMain.on('app:api-token' satisfies IpcChannels, (event) => {
    event.returnValue = trustedSender(event) ? apiToken() : '';
  });
}
