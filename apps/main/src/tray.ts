import { Tray, Menu, nativeImage, app } from 'electron';
import type { BrowserWindow } from 'electron';
import type { IpcChannels } from '@dash/shared';
import { restartServer } from './server/spawn';

// 16×16 four-square "dashboard" glyph, white on transparent. Marked as a
// template image on macOS so the menu bar recolors it for light/dark.
const ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKklEQVR42mNgoAb4//9/1H9MEEWsPMN/HIBY+WFiAGWBOPBgNB0M9XQAANIQM4/Di8GRAAAAAElFTkSuQmCC';

let tray: Tray | null = null;

function toggleWindow(win: BrowserWindow | null): void {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

/** Toggle Spotify playback via the local Fastify API — main-side fetch, no
 *  renderer involvement, so it works while the window is hidden. */
async function toggleSpotify(): Promise<void> {
  try {
    const res = await fetch('http://127.0.0.1:7432/api/spotify/now-playing', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return; // not authenticated / server down — silently no-op
    const data = (await res.json()) as { isPlaying?: boolean };
    await fetch(`http://127.0.0.1:7432/api/spotify/${data.isPlaying ? 'pause' : 'play'}`, {
      method: 'POST',
      signal: AbortSignal.timeout(4000),
    });
  } catch { /* server restarting — ignore */ }
}

export function createTray(getWindow: () => BrowserWindow | null): void {
  if (tray) return;
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_B64}`);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('Nishboard');

  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: () => toggleWindow(getWindow()) },
    { type: 'separator' },
    { label: 'Spotify Play/Pause', click: () => void toggleSpotify() },
    {
      label: 'Restart server',
      click: async () => {
        await restartServer();
        // Tell the renderer so it can refetch everything instead of erroring
        // until the next poll.
        getWindow()?.webContents.send('server:restarted' satisfies IpcChannels);
      },
    },
    { type: 'separator' },
    { label: 'Quit Nishboard', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);

  // Windows convention: single-click toggles; macOS opens the menu natively.
  tray.on('click', () => {
    if (process.platform !== 'darwin') toggleWindow(getWindow());
  });
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
