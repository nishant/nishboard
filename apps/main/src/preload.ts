import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ElectronAPI, IpcChannels, CredentialKey } from '@dash/shared';

const electronAPI: ElectronAPI = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('app:minimize' satisfies IpcChannels),
  close: () => ipcRenderer.send('app:close' satisfies IpcChannels),
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  openSpotifyAuth: (url: string) => ipcRenderer.send('spotify:open-auth' satisfies IpcChannels, url),
  onSpotifyTokenStored: (cb: () => void) => {
    const channel: IpcChannels = 'spotify:token-store';
    ipcRenderer.on(channel, cb);
    return () => ipcRenderer.removeListener(channel, cb);
  },
  credentials: {
    getAll: () =>
      ipcRenderer.invoke('credentials:get-all' satisfies IpcChannels) as Promise<
        Partial<Record<CredentialKey, string>>
      >,
    saveAll: (creds: Partial<Record<CredentialKey, string>>) =>
      ipcRenderer.invoke('credentials:save-all' satisfies IpcChannels, creds) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);
