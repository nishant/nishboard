import type { CredentialKey } from './credentials';

/** Quick-launcher item as the renderer sees it. The launch target (file path
 *  or URL) deliberately never crosses the bridge — the renderer launches by id
 *  and the main process resolves it. */
export interface LauncherItemData {
  id: string;
  label: string;
  kind: 'app' | 'url';
}

/** One clipboard-history entry. Text-only and in-memory only (main process) —
 *  history is never written to disk and dies with the app. */
export interface ClipboardEntryData {
  id: string;
  text: string;
  /** Epoch ms when captured. */
  at: number;
}

export type IpcChannels =
  | 'app:minimize'
  | 'app:close'
  | 'app:notify'
  | 'app:open-external'
  | 'spotify:open-auth'
  | 'spotify:token-store'
  | 'twitch:open-auth'
  | 'credentials:get-status'
  | 'credentials:save-all'
  | 'credentials:encryption-available'
  | 'launcher:get-items'
  | 'launcher:add-app'
  | 'launcher:add-url'
  | 'launcher:remove-item'
  | 'launcher:rename-item'
  | 'launcher:reorder'
  | 'launcher:launch'
  | 'clipboard:get-history'
  | 'clipboard:copy'
  | 'clipboard:clear'
  | 'clipboard:set-enabled'
  | 'clipboard:changed';

export interface ElectronAPI {
  /** Host OS, from the main process (`process.platform`): 'win32' | 'darwin' | 'linux' | … */
  platform: string;
  minimize: () => void;
  close: () => void;
  /** Set the renderer zoom factor (1 = 100%) for UI scaling. */
  setZoom: (factor: number) => void;
  /** Show a native desktop notification (with the OS notification sound). */
  notify: (title: string, body: string) => void;
  /** Open an http(s) URL in the user's default browser. */
  openExternal: (url: string) => void;
  openSpotifyAuth: (url: string) => void;
  /** Open a Twitch OAuth URL — main process rejects anything not on id.twitch.tv. */
  openTwitchAuth: (url: string) => void;
  onSpotifyTokenStored: (cb: () => void) => () => void;
  launcher: {
    getItems: () => Promise<LauncherItemData[]>;
    /** Opens the native file picker in the main process; the chosen path stays
     *  there. Resolves null when the user cancels. */
    addApp: () => Promise<LauncherItemData | null>;
    addUrl: (label: string, url: string) => Promise<LauncherItemData>;
    removeItem: (id: string) => Promise<void>;
    renameItem: (id: string, label: string) => Promise<void>;
    reorder: (ids: string[]) => Promise<void>;
    /** Launch by id — shell.openPath / openExternal happen main-side. */
    launch: (id: string) => Promise<void>;
  };
  clipboardHistory: {
    getHistory: () => Promise<ClipboardEntryData[]>;
    /** Put an entry's text back on the OS clipboard (by id). */
    copy: (id: string) => Promise<void>;
    clear: () => Promise<void>;
    /** Start/stop the main-process 1s poller — it runs ONLY while the widget
     *  is mounted and unpaused. */
    setEnabled: (enabled: boolean) => Promise<void>;
    /** Fires when a new entry is captured; returns unsubscribe. */
    onChanged: (cb: () => void) => () => void;
  };
  credentials: {
    /** Which keys are set — never the values. The Settings UI is write-only:
     *  stored keys can be replaced or cleared, never viewed ("secrets never
     *  reach the renderer"). */
    getStatus: () => Promise<Partial<Record<CredentialKey, boolean>>>;
    /** Merge semantics: non-empty string = set/replace; '' = clear; a key
     *  absent from the payload is left untouched. */
    saveAll: (creds: Partial<Record<CredentialKey, string>>) => Promise<void>;
    /** False when safeStorage has no OS keychain (some Linux setups) — keys
     *  are then stored as plaintext on disk and the UI should say so. */
    encryptionAvailable: () => Promise<boolean>;
  };
}
