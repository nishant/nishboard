import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type NetmonView = 'sparks' | 'bars';

// Ping targets + view mode persist; `configOpen` is ephemeral WidgetShell-header
// UI state (gear toggle) — partialize keeps it out so the panel never
// auto-opens on launch.
interface NetmonState {
  /** Hosts pinged by the server sampler (mirrors the /api/network validation). */
  hosts: string[];
  view: NetmonView;
  configOpen: boolean;
  setHosts: (hosts: string[]) => void;
  setView: (v: NetmonView) => void;
  toggleConfig: () => void;
}

export const useNetmonStore = create<NetmonState>()(
  persist(
    (set) => ({
      hosts: ['1.1.1.1', '8.8.8.8'],
      view: 'sparks',
      configOpen: false,
      setHosts: (hosts) => set({ hosts }),
      setView: (view) => set({ view }),
      toggleConfig: () => set((s) => ({ configOpen: !s.configOpen })),
    }),
    {
      name: 'dashboard-netmon',
      partialize: (s) => ({ hosts: s.hosts, view: s.view }),
    },
  ),
);
