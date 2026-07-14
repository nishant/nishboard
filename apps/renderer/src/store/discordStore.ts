import { create } from 'zustand';

// Ephemeral bridge between the Discord widget body (which owns the <webview>
// ref) and its sibling DiscordActions header row (registry pattern — no props
// flow between them). Nothing here persists: unread comes from the live tab
// title, controls die with the webview.

export interface DiscordControls {
  reload: () => void;
  /** Navigate back to DMs/friends (channels/@me). */
  goHome: () => void;
}

interface DiscordState {
  /** Mention count parsed from the webview's tab title. */
  unread: number;
  /** Registered by the mounted widget; null when no webview is live. */
  controls: DiscordControls | null;
  /** Header sign-out button → in-body confirm overlay. */
  signOutPrompt: boolean;
  setUnread: (unread: number) => void;
  registerControls: (controls: DiscordControls | null) => void;
  setSignOutPrompt: (open: boolean) => void;
}

export const useDiscordStore = create<DiscordState>((set) => ({
  unread: 0,
  controls: null,
  signOutPrompt: false,
  setUnread: (unread) => set({ unread }),
  registerControls: (controls) => set({ controls }),
  setSignOutPrompt: (signOutPrompt) => set({ signOutPrompt }),
}));
