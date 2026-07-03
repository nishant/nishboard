import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { STALE_ALERT_GRACE_MS } from './timersStore';

export interface CountdownEvent {
  id: string;
  label: string;
  /** Target wall-clock timestamp. */
  at: number;
  /** True once we've fired the notification for this event. */
  notified: boolean;
}

interface CountdownState {
  events: CountdownEvent[];
  addEvent: (label: string, at: number) => void;
  markNotified: (id: string) => void;
  removeEvent: (id: string) => void;
}

export const useCountdownStore = create<CountdownState>()(
  persist(
    (set) => ({
      events: [],
      addEvent: (label, at) =>
        set((s) => ({
          events: [...s.events, { id: crypto.randomUUID(), label, at, notified: false }].sort((a, b) => a.at - b.at),
        })),
      markNotified: (id) =>
        set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, notified: true } : e)) })),
      removeEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),
    }),
    {
      name: 'dashboard-countdown',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Settle events that passed while the app was closed so the widget tick
        // doesn't fire a notification burst on launch (same sweep as timersStore).
        const cutoff = Date.now() - STALE_ALERT_GRACE_MS;
        let missed = 0;
        state.events = state.events.map((e) => {
          if (e.notified || e.at >= cutoff) return e;
          missed += 1;
          return { ...e, notified: true };
        });
        if (missed > 0) {
          window.electron?.notify?.(
            'Nishboard',
            `${missed} countdown${missed === 1 ? '' : 's'} passed while the app was closed`,
          );
        }
      },
    },
  ),
);
