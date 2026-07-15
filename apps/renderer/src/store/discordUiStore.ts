import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Persisted Discord widget PREFERENCES — deliberately separate from
// discordStore, which is the ephemeral webview-host bridge (rects, controls)
// and must never be persisted. Only the mode lives here.
//
// 'embed'  — the real discord.com web app in the app-lifetime <webview> host.
// 'native' — local RPC to the RUNNING Discord desktop client (voice controls,
//            live read-only chat) via the Fastify /api/discord routes.
export type DiscordWidgetMode = 'embed' | 'native';

interface DiscordUiState {
  mode: DiscordWidgetMode;
  setMode: (mode: DiscordWidgetMode) => void;
}

export const useDiscordUiStore = create<DiscordUiState>()(
  persist(
    (set) => ({
      // Default 'embed' — the pre-native behavior; nobody's existing setup
      // flips modes on update.
      mode: 'embed',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'dashboard-discord-ui',
      partialize: (s) => ({ mode: s.mode }),
    },
  ),
);
