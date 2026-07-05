import type { CredentialKey } from './credentials';

/** Quick-launcher item as the renderer sees it. The launch target (file path
 *  or URL) deliberately never crosses the bridge — the renderer launches by id
 *  and the main process resolves it. */
export interface LauncherItemData {
  id: string;
  label: string;
  kind: 'app' | 'url';
  /** Group membership (LauncherGroupData id); absent = ungrouped. */
  group?: string;
  /** `data:` URI icon, resolved MAIN-SIDE (exe icon / favicon bytes). Never a
   *  remote URL — even a favicon URL would leak the target's hostname. */
  icon?: string;
}

export interface LauncherGroupData {
  id: string;
  label: string;
}

/** Full launcher state as the renderer sees it (targets stripped). */
export interface LauncherStateData {
  groups: LauncherGroupData[];
  items: LauncherItemData[];
}

/** One clipboard-history entry. Text-only and in-memory only (main process) —
 *  history is never written to disk and dies with the app. */
export interface ClipboardEntryData {
  id: string;
  text: string;
  /** Epoch ms when captured. */
  at: number;
}

/** Main-side app prefs (userData/prefs.json — NOT renderer localStorage: the
 *  close intercept and hotkey registration run before the renderer loads). */
export interface AppPrefsData {
  /** What the titlebar X does: quit the app, or hide to the tray. */
  closeAction: 'quit' | 'tray';
  /** Register the global show/hide hotkey (Ctrl/Cmd+Shift+D). */
  globalHotkey: boolean;
  /** Auto-export target folder (a Drive-for-Desktop/OneDrive/Dropbox folder
   *  makes it a synced backup). null = auto-export off. */
  backupDir: string | null;
}

/** Result of a manual update check against GitHub releases. */
export interface UpdateCheckData {
  currentVersion: string;
  /** Tag of the latest release (leading "v" stripped); null when none exist. */
  latestVersion: string | null;
  /** Release page URL to open when an update exists. */
  url: string | null;
  hasUpdate: boolean;
  /** Human-readable status ("No releases yet…", rate-limit/auth errors, …). */
  message?: string;
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
  | 'launcher:add-group'
  | 'launcher:rename-group'
  | 'launcher:remove-group'
  | 'launcher:assign-group'
  | 'launcher:launch-group'
  | 'launcher:refresh-icons'
  | 'clipboard:get-history'
  | 'clipboard:copy'
  | 'clipboard:clear'
  | 'clipboard:set-enabled'
  | 'clipboard:changed'
  | 'prefs:get'
  | 'prefs:set'
  | 'server:restarted'
  | 'server:restart'
  | 'app:get-version'
  | 'app:check-updates'
  | 'backup:choose-folder'
  | 'backup:write'
  | 'logs:open-folder';

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
  /** Fires after the Fastify child restarted (tray menu / Settings) —
   *  listeners should refetch queries. Returns unsubscribe. */
  onServerRestarted: (cb: () => void) => () => void;
  prefs: {
    get: () => Promise<AppPrefsData>;
    /** Partial patch; returns the resulting prefs. */
    set: (patch: Partial<AppPrefsData>) => Promise<AppPrefsData>;
  };
  app: {
    getVersion: () => Promise<string>;
    /** Manual GitHub latest-release check (24h memo main-side). */
    checkUpdates: () => Promise<UpdateCheckData>;
  };
  backup: {
    /** Native directory picker; persists the choice in main prefs and returns
     *  the path for display (null = cancelled). */
    chooseFolder: () => Promise<string | null>;
    /** Atomically write the settings payload into the chosen folder.
     *  No-ops when no folder is configured. */
    write: (payloadJson: string) => Promise<void>;
  };
  /** Open userData/logs in the OS file manager. */
  openLogsFolder: () => void;
  /** Restart the Fastify child; resolves once it's healthy again
   *  (also emits server:restarted). */
  restartServer: () => Promise<void>;
  launcher: {
    getItems: () => Promise<LauncherStateData>;
    /** Opens the native file picker in the main process; the chosen path stays
     *  there. Resolves null when the user cancels. */
    addApp: () => Promise<LauncherItemData | null>;
    addUrl: (label: string, url: string) => Promise<LauncherItemData>;
    removeItem: (id: string) => Promise<void>;
    renameItem: (id: string, label: string) => Promise<void>;
    reorder: (ids: string[]) => Promise<void>;
    /** Launch by id — shell.openPath / openExternal happen main-side. */
    launch: (id: string) => Promise<void>;
    addGroup: (label: string) => Promise<LauncherGroupData>;
    renameGroup: (id: string, label: string) => Promise<void>;
    /** Removing a group ungroups its members — items are never deleted. */
    removeGroup: (id: string) => Promise<void>;
    /** Move an item into a group (null = ungroup). */
    assignGroup: (itemId: string, groupId: string | null) => Promise<void>;
    /** Launch every member of a group, sequentially main-side. */
    launchGroup: (id: string) => Promise<void>;
    /** Re-derive icons for all items (exe icons + favicons, main-side). */
    refreshIcons: () => Promise<void>;
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
