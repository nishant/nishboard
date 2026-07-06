import { app, BrowserWindow, IpcMain, Notification, safeStorage, shell } from 'electron';
import { readCredentialStatus, writeCredentials } from '../credentials';
import { restartServer, logsDir } from '../server/spawn';
import { checkUpdates } from '../updates';
import { chooseBackupFolder, writeBackup } from '../backup';
import {
  getLauncherState, addLauncherApp, addLauncherUrl,
  removeLauncherItem, renameLauncherItem, reorderLauncherItems, launchItem,
  addLauncherGroup, renameLauncherGroup, removeLauncherGroup,
  assignLauncherGroup, launchGroup, refreshLauncherIcons,
} from '../launcher';
import {
  setClipboardWatch, getClipboardHistory, copyClipboardEntry, clearClipboardHistory,
} from '../clipboardHistory';
import { readPrefs, writePrefs } from '../prefs';
import { openPopout, closePopout, openPopoutIds } from '../popout';
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

  ipcMain.on('youtube:open-auth', (_event, url: string) => {
    if (typeof url !== 'string') return;
    if (url.startsWith('https://accounts.google.com/')) shell.openExternal(url);
  });

  ipcMain.on('google:open-auth', (_event, url: string) => {
    // Generic Google OAuth opener (Calendar, …) — same accounts.google.com guard.
    if (typeof url !== 'string') return;
    if (url.startsWith('https://accounts.google.com/')) shell.openExternal(url);
  });

  // ── Pop-out widget windows ──────────────────────────────────────────────────
  ipcMain.on('popout:open', (_event, widgetId: string) => {
    // Ids are renderer WidgetIds (lowercase slugs) — reject anything else.
    if (typeof widgetId === 'string' && /^[a-z]{2,20}$/.test(widgetId)) openPopout(widgetId);
  });
  ipcMain.on('popout:close', (_event, widgetId: string) => {
    if (typeof widgetId === 'string') closePopout(widgetId);
  });
  ipcMain.handle('popout:list', () => openPopoutIds());

  // ── Quick launcher ──────────────────────────────────────────────────────────
  // Targets (paths/URLs) live only in main — the renderer gets sanitized items
  // and launches by id.

  ipcMain.handle('launcher:get-items', () => getLauncherState());
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
  ipcMain.handle('launcher:add-group', (_event, label: string) =>
    addLauncherGroup(String(label ?? '')));
  ipcMain.handle('launcher:rename-group', (_event, id: string, label: string) =>
    renameLauncherGroup(String(id), String(label ?? '')));
  ipcMain.handle('launcher:remove-group', (_event, id: string) =>
    removeLauncherGroup(String(id)));
  ipcMain.handle('launcher:assign-group', (_event, itemId: string, groupId: string | null) =>
    assignLauncherGroup(String(itemId), groupId === null ? null : String(groupId)));
  ipcMain.handle('launcher:launch-group', (_event, id: string) => launchGroup(String(id)));
  ipcMain.handle('launcher:refresh-icons', () => refreshLauncherIcons());

  // ── About / updates / backup / logs ──────────────────────────────────────────

  ipcMain.handle('app:get-version', () => app.getVersion());
  ipcMain.handle('app:check-updates', () => checkUpdates());

  ipcMain.handle('backup:choose-folder', (event) =>
    chooseBackupFolder(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle('backup:write', (_event, payloadJson: string) => writeBackup(payloadJson));

  ipcMain.on('logs:open-folder', () => {
    void shell.openPath(logsDir());
  });

  ipcMain.handle('server:restart', async (event) => {
    await restartServer();
    event.sender.send('server:restarted');
  });

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
