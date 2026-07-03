import type { ElectronAPI } from '@dash/shared';

declare global {
  interface Window {
    // Optional: the contextBridge only exists inside Electron — in a plain
    // browser (vite dev preview) window.electron is undefined, and the type
    // must say so or every `window.electron?.` guard is type-theater while
    // unguarded call sites crash outside Electron.
    electron?: ElectronAPI;
  }
}
