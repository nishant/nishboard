import { app, BrowserWindow, ipcMain, session, globalShortcut, screen } from 'electron';
import path from 'path';
import { spawnServer, stopServer } from './server/spawn';
import { registerIpcHandlers } from './ipc';
import { createTray, destroyTray } from './tray';
import { readPrefs } from './prefs';
import { closeAllPopouts } from './popout';
import { initNativeTheme, readWindowTheme } from './windowTheme';
import { initDiscordSession, registerWebviewGuards } from './discord';
import { loadCredentials } from './credentials';
import { startAutoUpdates, isInstallingUpdate } from './updates';
import { clampToDisplays, readMainBounds, trackMainBounds, watchDisplays } from './windowBounds';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
// Set by before-quit: distinguishes a real quit from the titlebar X, which the
// close intercept below may translate into hide-to-tray.
let quitting = false;

const GLOBAL_HOTKEY = 'CommandOrControl+Shift+D';

/** (Un)register the global show/hide hotkey to match the pref. Called at
 *  startup and whenever prefs:set changes it. */
export function syncGlobalHotkey(): void {
  globalShortcut.unregister(GLOBAL_HOTKEY);
  if (!readPrefs().globalHotkey) return;
  globalShortcut.register(GLOBAL_HOTKEY, () => {
    const win = mainWindow;
    if (!win) return;
    if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
      win.hide();
    } else {
      win.show();
      win.focus();
    }
  });
}

function createWindow(): void {
  // Frameless on both platforms (custom titlebar). The window is OPAQUE on
  // Windows: a transparent frameless window there disables Aero Snap
  // (drag-to-top / drag-to-side maximize), double-click-titlebar maximize, AND
  // the hardware-accelerated resize path (transparency forces slow per-pixel
  // alpha compositing → janky corner drags). We used to make it transparent only
  // to round the corners in CSS; native window behavior is worth far more than
  // rounded corners, so Windows now matches macOS's opaque frameless window.
  const saved = readMainBounds();
  const bounds = saved
    ? clampToDisplays(
        { x: saved.x, y: saved.y, width: saved.width, height: saved.height },
        screen.getAllDisplays().map((d) => d.workArea),
        screen.getPrimaryDisplay().workArea,
      )
    : null;
  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1920,
    height: bounds?.height ?? 1080,
    ...(bounds ? { x: bounds.x, y: bounds.y } : { center: true }),
    minWidth: 360,
    minHeight: 480,
    frame: false,
    resizable: true,
    // The saved theme's --nish-bg (windowTheme.ts), so a light theme does not
    // flash dark at launch.
    backgroundColor: readWindowTheme().bg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // For the Discord widget's <webview> ONLY — every attach is validated by
      // registerWebviewGuards() (discord.com src, preload/node stripped).
      webviewTag: true,
    },
  });

  if (saved?.maximized) mainWindow.maximize();
  trackMainBounds(mainWindow);

  // The window hosts third-party embeds (YouTube/Twitch iframes, with the Twitch
  // CSP strip below) — never let them open windows or navigate the top frame.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith('http://localhost:5173') : url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });

  // DevTools on Cmd+Option+I (mac) / Ctrl+Alt+I (win), any build — scoped to this
  // window's input instead of a globalShortcut, which would steal the combo
  // system-wide from every other app while Nishboard runs.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const mod = process.platform === 'darwin' ? input.meta && input.alt : input.control && input.alt;
    if (input.type === 'keyDown' && mod && input.key.toLowerCase() === 'i') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // __dirname = app/dist/ → one level up reaches app/ → renderer/dist/index.html
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }

  // Close-to-tray: when the pref says 'tray' and this isn't a real quit,
  // the titlebar X just hides the window (the tray keeps the app reachable).
  mainWindow.on('close', (event) => {
    if (!quitting && !isInstallingUpdate() && readPrefs().closeAction === 'tray') {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // No main window → no way to manage floaters; don't leave orphans.
    closeAllPopouts();
  });
}

// Single-instance: a second launch would run killStaleOnPort(7432) in production
// and SIGKILL the first instance's server out from under it. The second instance
// quits at once and registers nothing, so no server or window code runs in it.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Saved theme source first, so native chrome matches before the renderer loads.
    initNativeTheme();

    // Strip "Electron/x.x.x" from the user-agent so YouTube (and other sites that
    // block Electron) see a plain Chrome browser instead of the Electron shell.
    const ua = session.defaultSession.getUserAgent().replace(/\s*Electron\/[\d.]+/, '');
    session.defaultSession.setUserAgent(ua);

    // Some embedded documents send a `frame-ancestors` CSP that validates the ENTIRE
    // ancestor chain — so the top-level renderer (file:// in prod) violates it even
    // though our embed proxy is on localhost:
    //   • player.twitch.tv → `frame-ancestors http://localhost:*`
    //   • www.rainviewer.com/map.html (weather radar) → `frame-ancestors *`, and `*`
    //     matches only network schemes, not file://.
    // Strip CSP only from these framed document responses — media/tile CDNs
    // (*.ttvnw.net, rainviewer tile hosts) are untouched, so playback/tiles/auth are
    // unaffected. Radar works in dev (renderer is http://localhost:5173) regardless.
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ['*://player.twitch.tv/*', '*://www.rainviewer.com/*'] },
      (details, callback) => {
        const responseHeaders = { ...details.responseHeaders };
        for (const key of Object.keys(responseHeaders)) {
          if (key.toLowerCase().startsWith('content-security-policy')) {
            delete responseHeaders[key];
          }
        }
        callback({ responseHeaders });
      },
    );

    // Discord widget plumbing — partition session + <webview> attach guards must
    // exist before any window can host the webview.
    initDiscordSession();
    registerWebviewGuards();

    await loadCredentials();
    await spawnServer();
    registerIpcHandlers(ipcMain, { onPrefsChanged: syncGlobalHotkey });
    createWindow();
    createTray(() => mainWindow);
    syncGlobalHotkey();
    watchDisplays(() => BrowserWindow.getAllWindows());
    startAutoUpdates(() => BrowserWindow.getAllWindows());
  });

  app.on('window-all-closed', () => {
    // Don't stop the server here: on macOS the app stays alive after the window
    // closes, and `activate` only re-creates the window — a server killed here
    // would leave every widget dead on reopen. before-quit covers both platforms
    // (on Windows/Linux app.quit() below triggers it).
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true; // let the close intercept pass instead of hiding
    globalShortcut.unregisterAll();
    destroyTray();
    stopServer();
  });

  app.on('activate', () => {
    if (mainWindow === null) createWindow();
  });
}
