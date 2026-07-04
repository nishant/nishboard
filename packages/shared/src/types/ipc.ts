import type { CredentialKey } from './credentials';

export type IpcChannels =
  | 'app:minimize'
  | 'app:close'
  | 'app:notify'
  | 'app:open-external'
  | 'spotify:open-auth'
  | 'spotify:token-store'
  | 'credentials:get-status'
  | 'credentials:save-all'
  | 'credentials:encryption-available';

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
  onSpotifyTokenStored: (cb: () => void) => () => void;
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
