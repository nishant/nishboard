import { app, BrowserWindow, IpcMain, Notification, safeStorage, shell } from 'electron';
import { readCredentialStatus, writeCredentials } from '../credentials';
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

  // Write-only credentials: the renderer learns which keys are set, never
  // their values (get-all was removed — decrypted keys used to prefill the
  // Settings form, violating "secrets never reach the renderer").
  ipcMain.handle('credentials:get-status', () => {
    return readCredentialStatus();
  });

  ipcMain.handle('credentials:save-all', async (_event, creds: Partial<Record<CredentialKey, string>>) => {
    writeCredentials(creds);
    await restartServer();
  });

  ipcMain.handle('credentials:encryption-available', () => {
    return safeStorage.isEncryptionAvailable();
  });
}
