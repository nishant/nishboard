import { app, BrowserWindow, IpcMain, Notification, shell } from 'electron';
import { readCredentials, writeCredentials } from '../credentials';
import { restartServer } from '../server/spawn';
import type { CredentialKey } from '@dash/shared';

export function registerIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.on('app:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });

  ipcMain.on('app:close', () => {
    app.quit();
  });

  ipcMain.on('app:notify', (_event, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show(); // silent defaults to false → OS sound
    }
  });

  ipcMain.on('app:open-external', (_event, url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.on('spotify:open-auth', (_event, url: string) => {
    // The auth URL is always built by our own /auth-url route — anything else
    // reaching this channel is not a legitimate Spotify OAuth flow.
    if (url.startsWith('https://accounts.spotify.com/')) shell.openExternal(url);
  });

  // ── Credentials ─────────────────────────────────────────────────────────────

  ipcMain.handle('credentials:get-all', () => {
    return readCredentials();
  });

  ipcMain.handle('credentials:save-all', async (_event, creds: Partial<Record<CredentialKey, string>>) => {
    writeCredentials(creds);
    await restartServer();
  });
}
