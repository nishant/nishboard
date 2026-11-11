import { app, BrowserWindow, IpcMain, Notification, safeStorage, shell } from 'electron';
import { readCredentialStatus, writeCredentials } from '../credentials';
import { restartServer, logsDir } from '../server/spawn';
import { checkUpdates, clearUpdateMemo, getUpdateStatus, installUpdate } from '../updates';
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
import {
  signOutDiscord, setDiscordScreenShareWatch, selectDiscordScreenShareSource,
} from '../discord';
import { openClaudeLogin } from '../claudeLogin';
import { readPrefs, writePrefs } from '../prefs';
import { openPopout, closePopout, openPopoutIds, isTransparentPopout } from '../popout';
import { setWindowTheme } from '../windowTheme';
import { isAllowedExternalUrl, isAuthUrl, isValidPopoutId } from './guards';
import type { CredentialKey, AppPrefsData } from '@dash/shared';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  hooks: { onPrefsChanged?: () => void } = {},
): void {
  ipcMain.on('app:minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });

  // Theme sync: nativeTheme.themeSource + every window's background (windowTheme.ts).
  ipcMain.on('app:set-theme', (_event, source: unknown, bg: unknown) => {
    setWindowTheme(source, bg, isTransparentPopout);
  });

  ipcMain.on('app:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on('app:close', (event) => {
    // Close the window (not app.quit()) so the close-to-tray intercept in
    // index.ts gets to apply the closeAction pref.
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on('app:notify', (_event, title: string, body: string) => {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body }); // silent defaults to false → OS sound
      n.on('failed', (_e, err) => console.warn('[notify] failed:', err));
      n.show();
    }
  });

  ipcMain.on('app:open-external', (_event, url: unknown) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
  });

  // The auth URL is always built by our own /auth-url route; anything else
  // reaching these channels is not a legitimate OAuth flow (guards.ts).
  ipcMain.on('spotify:open-auth', (_event, url: unknown) => {
    if (isAuthUrl('spotify', url)) shell.openExternal(url);
  });

  ipcMain.on('twitch:open-auth', (_event, url: unknown) => {
    if (isAuthUrl('twitch', url)) shell.openExternal(url);
  });

  ipcMain.on('youtube:open-auth', (_event, url: unknown) => {
    if (isAuthUrl('youtube', url)) shell.openExternal(url);
  });

  ipcMain.on('google:open-auth', (_event, url: unknown) => {
    // Generic Google OAuth opener (Calendar, ...), same accounts.google.com guard.
    if (isAuthUrl('google', url)) shell.openExternal(url);
  });

  // ── Pop-out widget windows ──────────────────────────────────────────────────
  ipcMain.on('popout:open', (_event, widgetId: unknown) => {
    // Ids are renderer WidgetIds (lowercase slugs) — reject anything else.
    if (isValidPopoutId(widgetId)) openPopout(widgetId);
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
  ipcMain.handle('app:get-update-status', () => getUpdateStatus());
  ipcMain.handle('app:install-update', () => installUpdate());

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
    // backupDir is written only by chooseBackupFolder (native picker); the
    // renderer may turn auto-export off (null) but never set a path.
    const safe: Partial<AppPrefsData> = { ...(patch ?? {}) };
    if (safe.backupDir !== null) delete safe.backupDir;
    const next = writePrefs(safe);
    hooks.onPrefsChanged?.(); // e.g. re-sync the global-hotkey registration
    return next;
  });

  // ── Clipboard history (text-only, in-memory, poller gated by the widget) ────

  ipcMain.handle('clipboard:get-history', () => getClipboardHistory());
  ipcMain.handle('clipboard:copy', (_event, id: string) => copyClipboardEntry(String(id)));
  ipcMain.handle('clipboard:clear', () => clearClipboardHistory());
  ipcMain.handle('clipboard:set-enabled', (event, enabled: boolean) =>
    setClipboardWatch(enabled === true, event.sender));

  // ── Claude CLI one-click login (terminal spawn + credentials watcher) ───────

  ipcMain.handle('claude:open-login', () => openClaudeLogin());

  // ── Discord widget (persist:discord webview — sign-out + screen-share picker) ─

  ipcMain.handle('discord:sign-out', () => signOutDiscord());
  ipcMain.handle('discord:screenshare-watch', (event, enabled: boolean) =>
    setDiscordScreenShareWatch(enabled === true, event.sender));
  ipcMain.handle('discord:screenshare-select', (_event, requestId: string, sourceId: string | null) =>
    selectDiscordScreenShareSource(String(requestId), sourceId === null ? null : String(sourceId)));

  // ── Credentials ─────────────────────────────────────────────────────────────

  // Write-only credentials: the renderer learns which keys are set, never
  // their values (get-all was removed — decrypted keys used to prefill the
  // Settings form, violating "secrets never reach the renderer").
  ipcMain.handle('credentials:get-status', () => {
    return readCredentialStatus();
  });

  ipcMain.handle('credentials:save-all', async (_event, creds: Partial<Record<CredentialKey, string>>) => {
    await writeCredentials(creds);
    clearUpdateMemo(); // a new GITHUB_TOKEN must take effect on the next check
    await restartServer();
  });

  ipcMain.handle('credentials:encryption-available', async () => {
    return await safeStorage.isAsyncEncryptionAvailable();
  });
}
