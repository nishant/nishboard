import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'path';
import { spawnServer, stopServer } from './server/spawn';
import { registerIpcHandlers } from './ipc';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

// Single-instance: a second launch would run killStaleOnPort(7432) in production
// and SIGKILL the first instance's server out from under it. Hand off to the
// running instance instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

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
});

app.on('window-all-closed', () => {
  // Don't stop the server here: on macOS the app stays alive after the window
  // closes, and `activate` only re-creates the window — a server killed here
  // would leave every widget dead on reopen. before-quit covers both platforms
  // (on Windows/Linux app.quit() below triggers it).
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopServer();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
