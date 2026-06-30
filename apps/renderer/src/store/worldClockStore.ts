import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ClockView = 'digital' | 'analog';

interface WorldClockState {
  zones: string[]; // IANA timezone names, e.g. 'America/New_York'
  view: ClockView;
  addZone: (tz: string) => void;
  removeZone: (tz: string) => void;
  setView: (view: ClockView) => void;
}

function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const useWorldClockStore = create<WorldClockState>()(
  persist(
    (set) => ({
      zones: [localZone()],
      view: 'digital',
      addZone: (tz) => set((s) => (s.zones.includes(tz) ? s : { zones: [...s.zones, tz] })),
      removeZone: (tz) => set((s) => ({ zones: s.zones.filter((z) => z !== tz) })),
      setView: (view) => set({ view }),
    }),
    { name: 'dashboard-worldclock' },
  ),
);
