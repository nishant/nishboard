import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TimerItem {
  id: string;
  label: string;
  durationMs: number;
  running: boolean;
  /** Target end timestamp while running (survives reload); null when paused/stopped. */
  endsAt: number | null;
  /** Frozen remaining time while paused/stopped. */
  remainingMs: number;
}

export interface AlarmItem {
  id: string;
  label: string;
  /** Target wall-clock timestamp. */
  at: number;
  done: boolean;
}

interface TimersState {
  timers: TimerItem[];
  alarms: AlarmItem[];

  addTimer: (label: string, durationMs: number) => void;
  startTimer: (id: string) => void;
  pauseTimer: (id: string) => void;
  resetTimer: (id: string) => void;
  /** Mark a timer finished (called when it reaches zero). */
  finishTimer: (id: string) => void;
  removeTimer: (id: string) => void;

  addAlarm: (label: string, at: number) => void;
  markAlarmDone: (id: string) => void;
  removeAlarm: (id: string) => void;
}

export const useTimersStore = create<TimersState>()(
  persist(
    (set) => ({
      timers: [],
      alarms: [],

      addTimer: (label, durationMs) =>
        set((s) => ({
          timers: [
            ...s.timers,
            { id: crypto.randomUUID(), label, durationMs, running: false, endsAt: null, remainingMs: durationMs },
          ],
        })),
      startTimer: (id) =>
        set((s) => ({
          timers: s.timers.map((t) =>
            t.id === id && !t.running && t.remainingMs > 0
              ? { ...t, running: true, endsAt: Date.now() + t.remainingMs }
              : t,
          ),
        })),
      pauseTimer: (id) =>
        set((s) => ({
          timers: s.timers.map((t) =>
            t.id === id && t.running
              ? { ...t, running: false, remainingMs: Math.max(0, (t.endsAt ?? Date.now()) - Date.now()), endsAt: null }
              : t,
          ),
        })),
      resetTimer: (id) =>
        set((s) => ({
          timers: s.timers.map((t) =>
            t.id === id ? { ...t, running: false, endsAt: null, remainingMs: t.durationMs } : t,
          ),
        })),
      finishTimer: (id) =>
        set((s) => ({
          timers: s.timers.map((t) =>
            t.id === id ? { ...t, running: false, endsAt: null, remainingMs: 0 } : t,
          ),
        })),
      removeTimer: (id) => set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),

      addAlarm: (label, at) =>
        set((s) => ({
          alarms: [...s.alarms, { id: crypto.randomUUID(), label, at, done: false }].sort((a, b) => a.at - b.at),
        })),
      markAlarmDone: (id) =>
        set((s) => ({ alarms: s.alarms.map((a) => (a.id === id ? { ...a, done: true } : a)) })),
      removeAlarm: (id) => set((s) => ({ alarms: s.alarms.filter((a) => a.id !== id) })),
    }),
    { name: 'dashboard-timers' },
  ),
);
