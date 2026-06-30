import type { CredentialKey } from './credentials';

export type IpcChannels =
  | 'app:minimize'
  | 'app:close'
  | 'app:notify'
  | 'spotify:open-auth'
  | 'spotify:token-store'
  | 'credentials:get-all'
  | 'credentials:save-all';

export interface ElectronAPI {
  /** Host OS, from the main process (`process.platform`): 'win32' | 'darwin' | 'linux' | … */
  platform: string;
  minimize: () => void;
  close: () => void;
  /** Set the renderer zoom factor (1 = 100%) for UI scaling. */
  setZoom: (factor: number) => void;
  /** Show a native desktop notification (with the OS notification sound). */
  notify: (title: string, body: string) => void;
  openSpotifyAuth: (url: string) => void;
  onSpotifyTokenStored: (cb: () => void) => () => void;
  credentials: {
    getAll: () => Promise<Partial<Record<CredentialKey, string>>>;
    saveAll: (creds: Partial<Record<CredentialKey, string>>) => Promise<void>;
  };
}
