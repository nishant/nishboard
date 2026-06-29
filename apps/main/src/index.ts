import { app, BrowserWindow, ipcMain, globalShortcut, session } from 'electron';
import path from 'path';
import { spawnServer, stopServer } from './server/spawn';
import { registerIpcHandlers } from './ipc';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Windows: a transparent frameless window lets the renderer round its own corners
  // (CSS) and have the desktop show through, matching macOS's native rounded window.
  // macOS rounds frameless windows natively, so it stays opaque (no transparency artifacts).
  const isWin = process.platform === 'win32';

  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    resizable: true,
    ...(isWin
      ? { transparent: true, backgroundColor: '#00000000' }
      : { backgroundColor: '#09090b' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // __dirname = app/dist/ → one level up reaches app/ → renderer/dist/index.html
    mainWindow.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  // Strip "Electron/x.x.x" from the user-agent so YouTube (and other sites that
  // block Electron) see a plain Chrome browser instead of the Electron shell.
  const ua = session.defaultSession.getUserAgent().replace(/\s*Electron\/[\d.]+/, '');
  session.defaultSession.setUserAgent(ua);

  // The Twitch player document sends `frame-ancestors http://localhost:*` in its
  // CSP. frame-ancestors validates the ENTIRE ancestor chain, so the top-level
  // renderer (file:// in prod) violates it even though the embed proxy is on
  // localhost. Strip CSP only from the player document responses — the video CDN
  // (*.ttvnw.net) is untouched, so playback/auth are unaffected.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://player.twitch.tv/*'] },
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

  await spawnServer();
  registerIpcHandlers(ipcMain);
  createWindow();

  // Cmd+Option+I (mac) / Ctrl+Shift+I (win) opens DevTools in any build
  globalShortcut.register('CommandOrControl+Option+I', () => {
    mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
