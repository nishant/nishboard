import { app, BrowserWindow, ipcMain, globalShortcut, session } from 'electron';
import path from 'path';
import { spawnServer, stopServer } from './server/spawn';
import { registerIpcHandlers } from './ipc';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    frame: false,
    resizable: true,
    backgroundColor: '#09090b',
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
