import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ElectronAPI, IpcChannels, CredentialKey, LauncherItemData } from '@dash/shared';

const electronAPI: ElectronAPI = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('app:minimize' satisfies IpcChannels),
  close: () => ipcRenderer.send('app:close' satisfies IpcChannels),
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  notify: (title: string, body: string) => ipcRenderer.send('app:notify' satisfies IpcChannels, title, body),
  openExternal: (url: string) => ipcRenderer.send('app:open-external' satisfies IpcChannels, url),
  openSpotifyAuth: (url: string) => ipcRenderer.send('spotify:open-auth' satisfies IpcChannels, url),
  openTwitchAuth: (url: string) => ipcRenderer.send('twitch:open-auth' satisfies IpcChannels, url),
  onSpotifyTokenStored: (cb: () => void) => {
    const channel: IpcChannels = 'spotify:token-store';
    ipcRenderer.on(channel, cb);
    return () => ipcRenderer.removeListener(channel, cb);
  },
  launcher: {
    getItems: () =>
      ipcRenderer.invoke('launcher:get-items' satisfies IpcChannels) as Promise<LauncherItemData[]>,
    addApp: () =>
      ipcRenderer.invoke('launcher:add-app' satisfies IpcChannels) as Promise<LauncherItemData | null>,
    addUrl: (label: string, url: string) =>
      ipcRenderer.invoke('launcher:add-url' satisfies IpcChannels, label, url) as Promise<LauncherItemData>,
    removeItem: (id: string) =>
      ipcRenderer.invoke('launcher:remove-item' satisfies IpcChannels, id) as Promise<void>,
    renameItem: (id: string, label: string) =>
      ipcRenderer.invoke('launcher:rename-item' satisfies IpcChannels, id, label) as Promise<void>,
    reorder: (ids: string[]) =>
      ipcRenderer.invoke('launcher:reorder' satisfies IpcChannels, ids) as Promise<void>,
    launch: (id: string) =>
      ipcRenderer.invoke('launcher:launch' satisfies IpcChannels, id) as Promise<void>,
  },
  credentials: {
    getStatus: () =>
      ipcRenderer.invoke('credentials:get-status' satisfies IpcChannels) as Promise<
        Partial<Record<CredentialKey, boolean>>
      >,
    saveAll: (creds: Partial<Record<CredentialKey, string>>) =>
      ipcRenderer.invoke('credentials:save-all' satisfies IpcChannels, creds) as Promise<void>,
    encryptionAvailable: () =>
      ipcRenderer.invoke('credentials:encryption-available' satisfies IpcChannels) as Promise<boolean>,
  },
};

contextBridge.exposeInMainWorld('electron', electronAPI);
