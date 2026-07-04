import { BrowserWindow, IpcMain, Notification, safeStorage, shell } from 'electron';
import { readCredentialStatus, writeCredentials } from '../credentials';
import { restartServer } from '../server/spawn';
import {
  getLauncherItems, addLauncherApp, addLauncherUrl,
  removeLauncherItem, renameLauncherItem, reorderLauncherItems, launchItem,
} from '../launcher';
import {
  setClipboardWatch, getClipboardHistory, copyClipboardEntry, clearClipboardHistory,
} from '../clipboardHistory';
import { readPrefs, writePrefs } from '../prefs';
import type { CredentialKey, AppPrefsData } from '@dash/shared';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  hooks: { onPrefsChanged?: () => void } = {},
): void {
  ipcMain.on('app:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });

  ipcMain.on('app:close', (event) => {
    // Close the window (not app.quit()) so the close-to-tray intercept in
    // index.ts gets to apply the closeAction pref.
    BrowserWindow.fromWebContents(event.sender)?.close();
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

  ipcMain.on('twitch:open-auth', (_event, url: string) => {
    // Same guard pattern: only Twitch's identity host is a legitimate target.
    if (url.startsWith('https://id.twitch.tv/')) shell.openExternal(url);
  });

  // ── Quick launcher ──────────────────────────────────────────────────────────
  // Targets (paths/URLs) live only in main — the renderer gets sanitized items
  // and launches by id.

  ipcMain.handle('launcher:get-items', () => getLauncherItems());
  ipcMain.handle('launcher:add-app', (event) =>
    addLauncherApp(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle('launcher:add-url', (_event, label: string, url: string) =>
    addLauncherUrl(String(label ?? ''), String(url ?? '')));
  ipcMain.handle('launcher:remove-item', (_event, id: string) => removeLauncherItem(String(id)));
  ipcMain.handle('launcher:rename-item', (_event, id: string, label: string) =>
    renameLauncherItem(String(id), String(label ?? '')));
  ipcMain.handle('launcher:reorder', (_event, ids: string[]) =>
    reorderLauncherItems(Array.isArray(ids) ? ids.map(String) : []));
  ipcMain.handle('launcher:launch', (_event, id: string) => launchItem(String(id)));

  // ── App prefs (main-side prefs.json — close action + global hotkey) ─────────

  ipcMain.handle('prefs:get', () => readPrefs());
  ipcMain.handle('prefs:set', (_event, patch: Partial<AppPrefsData>) => {
    const next = writePrefs(patch ?? {});
    hooks.onPrefsChanged?.(); // e.g. re-sync the global-hotkey registration
    return next;
  });

  // ── Clipboard history (text-only, in-memory, poller gated by the widget) ────

  ipcMain.handle('clipboard:get-history', () => getClipboardHistory());
  ipcMain.handle('clipboard:copy', (_event, id: string) => copyClipboardEntry(String(id)));
  ipcMain.handle('clipboard:clear', () => clearClipboardHistory());
  ipcMain.handle('clipboard:set-enabled', (event, enabled: boolean) =>
    setClipboardWatch(enabled === true, event.sender));

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
