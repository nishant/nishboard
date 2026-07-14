import { contextBridge, ipcRenderer, webFrame } from 'electron';
import type { ElectronAPI, IpcChannels, CredentialKey, LauncherItemData, LauncherGroupData, LauncherStateData, ClipboardEntryData, AppPrefsData, UpdateCheckData, DiscordScreenShareRequestData, ClaudeLoginOpenResult } from '@dash/shared';

const electronAPI: ElectronAPI = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('app:minimize' satisfies IpcChannels),
  toggleMaximize: () => ipcRenderer.send('app:toggle-maximize' satisfies IpcChannels),
  close: () => ipcRenderer.send('app:close' satisfies IpcChannels),
  setZoom: (factor: number) => webFrame.setZoomFactor(factor),
  notify: (title: string, body: string) => ipcRenderer.send('app:notify' satisfies IpcChannels, title, body),
  openExternal: (url: string) => ipcRenderer.send('app:open-external' satisfies IpcChannels, url),
  openSpotifyAuth: (url: string) => ipcRenderer.send('spotify:open-auth' satisfies IpcChannels, url),
  openTwitchAuth: (url: string) => ipcRenderer.send('twitch:open-auth' satisfies IpcChannels, url),
  openYoutubeAuth: (url: string) => ipcRenderer.send('youtube:open-auth' satisfies IpcChannels, url),
  openGoogleAuth: (url: string) => ipcRenderer.send('google:open-auth' satisfies IpcChannels, url),
  popout: {
    open: (widgetId: string) => ipcRenderer.send('popout:open' satisfies IpcChannels, widgetId),
    close: (widgetId: string) => ipcRenderer.send('popout:close' satisfies IpcChannels, widgetId),
    list: () => ipcRenderer.invoke('popout:list' satisfies IpcChannels) as Promise<string[]>,
    onChanged: (cb: (ids: string[]) => void) => {
      const channel: IpcChannels = 'popout:changed';
      const listener = (_event: Electron.IpcRendererEvent, ids: string[]) => cb(ids);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  onSpotifyTokenStored: (cb: () => void) => {
    const channel: IpcChannels = 'spotify:token-store';
    ipcRenderer.on(channel, cb);
    return () => ipcRenderer.removeListener(channel, cb);
  },
  onServerRestarted: (cb: () => void) => {
    const channel: IpcChannels = 'server:restarted';
    ipcRenderer.on(channel, cb);
    return () => ipcRenderer.removeListener(channel, cb);
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get' satisfies IpcChannels) as Promise<AppPrefsData>,
    set: (patch: Partial<AppPrefsData>) =>
      ipcRenderer.invoke('prefs:set' satisfies IpcChannels, patch) as Promise<AppPrefsData>,
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version' satisfies IpcChannels) as Promise<string>,
    checkUpdates: () =>
      ipcRenderer.invoke('app:check-updates' satisfies IpcChannels) as Promise<UpdateCheckData>,
  },
  backup: {
    chooseFolder: () =>
      ipcRenderer.invoke('backup:choose-folder' satisfies IpcChannels) as Promise<string | null>,
    write: (payloadJson: string) =>
      ipcRenderer.invoke('backup:write' satisfies IpcChannels, payloadJson) as Promise<void>,
  },
  openLogsFolder: () => ipcRenderer.send('logs:open-folder' satisfies IpcChannels),
  restartServer: () => ipcRenderer.invoke('server:restart' satisfies IpcChannels) as Promise<void>,
  launcher: {
    getItems: () =>
      ipcRenderer.invoke('launcher:get-items' satisfies IpcChannels) as Promise<LauncherStateData>,
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
    addGroup: (label: string) =>
      ipcRenderer.invoke('launcher:add-group' satisfies IpcChannels, label) as Promise<LauncherGroupData>,
    renameGroup: (id: string, label: string) =>
      ipcRenderer.invoke('launcher:rename-group' satisfies IpcChannels, id, label) as Promise<void>,
    removeGroup: (id: string) =>
      ipcRenderer.invoke('launcher:remove-group' satisfies IpcChannels, id) as Promise<void>,
    assignGroup: (itemId: string, groupId: string | null) =>
      ipcRenderer.invoke('launcher:assign-group' satisfies IpcChannels, itemId, groupId) as Promise<void>,
    launchGroup: (id: string) =>
      ipcRenderer.invoke('launcher:launch-group' satisfies IpcChannels, id) as Promise<void>,
    refreshIcons: () =>
      ipcRenderer.invoke('launcher:refresh-icons' satisfies IpcChannels) as Promise<void>,
  },
  clipboardHistory: {
    getHistory: () =>
      ipcRenderer.invoke('clipboard:get-history' satisfies IpcChannels) as Promise<ClipboardEntryData[]>,
    copy: (id: string) =>
      ipcRenderer.invoke('clipboard:copy' satisfies IpcChannels, id) as Promise<void>,
    clear: () => ipcRenderer.invoke('clipboard:clear' satisfies IpcChannels) as Promise<void>,
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke('clipboard:set-enabled' satisfies IpcChannels, enabled) as Promise<void>,
    onChanged: (cb: () => void) => {
      const channel: IpcChannels = 'clipboard:changed';
      ipcRenderer.on(channel, cb);
      return () => ipcRenderer.removeListener(channel, cb);
    },
  },
  claude: {
    openLogin: () =>
      ipcRenderer.invoke('claude:open-login' satisfies IpcChannels) as Promise<ClaudeLoginOpenResult>,
    onLoginFinished: (cb: () => void) => {
      const channel: IpcChannels = 'claude:login-finished';
      ipcRenderer.on(channel, cb);
      return () => ipcRenderer.removeListener(channel, cb);
    },
  },
  discord: {
    signOut: () => ipcRenderer.invoke('discord:sign-out' satisfies IpcChannels) as Promise<void>,
    setScreenShareWatch: (enabled: boolean) =>
      ipcRenderer.invoke('discord:screenshare-watch' satisfies IpcChannels, enabled) as Promise<void>,
    selectScreenShareSource: (requestId: string, sourceId: string | null) =>
      ipcRenderer.invoke('discord:screenshare-select' satisfies IpcChannels, requestId, sourceId) as Promise<void>,
    onScreenShareRequest: (cb: (req: DiscordScreenShareRequestData) => void) => {
      const channel: IpcChannels = 'discord:screenshare-request';
      const listener = (_event: Electron.IpcRendererEvent, req: DiscordScreenShareRequestData) => cb(req);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
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
