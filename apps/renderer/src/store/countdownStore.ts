import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
    { name: 'dashboard-countdown' },
  ),
);
