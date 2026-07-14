import { create } from 'zustand';

// Ephemeral bridge between the app-lifetime DiscordHost (which owns the
// <webview>) and the grid tile / header actions. Nothing here persists.
//
// WHY a host + rect instead of the webview living in the widget: Discord web
// reads its auth token OUT of localStorage into memory on startup and only
// writes it back on a graceful unload (beforeunload). Unmounting a <webview>
// destroys the guest abruptly — no unload, token never restored → next mount
// is a login screen. So the guest must never be destroyed mid-session: the
// widget tile only ACTIVATES the host and publishes its body rect; the host
// overlays that rect and merely hides (0×0, never display:none) when the tile
// is collapsed, unpinned, or absent from the current layout.

export interface DiscordHostRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiscordControls {
  reload: () => void;
  /** Navigate back to DMs/friends (channels/@me). */
  goHome: () => void;
}

interface DiscordState {
  /** Latched true the first time the widget mounts this run — the host then
   *  lives (and stays signed in) until the window closes. */
  active: boolean;
  /** Live viewport rect of the widget tile's body; null = tile not visible
   *  (host hides at 0×0 but the guest keeps running). */
  hostRect: DiscordHostRect | null;
  /** Mention count parsed from the webview's tab title. */
  unread: number;
  /** Registered by the host; null when no webview is live. */
  controls: DiscordControls | null;
  /** Header sign-out button → in-body confirm overlay. */
  signOutPrompt: boolean;
  activate: () => void;
  setHostRect: (rect: DiscordHostRect | null) => void;
  setUnread: (unread: number) => void;
  registerControls: (controls: DiscordControls | null) => void;
  setSignOutPrompt: (open: boolean) => void;
}

export const useDiscordStore = create<DiscordState>((set) => ({
  active: false,
  hostRect: null,
  unread: 0,
  controls: null,
  signOutPrompt: false,
  activate: () => set({ active: true }),
  setHostRect: (hostRect) => set({ hostRect }),
  setUnread: (unread) => set({ unread }),
  registerControls: (controls) => set({ controls }),
  setSignOutPrompt: (signOutPrompt) => set({ signOutPrompt }),
}));
