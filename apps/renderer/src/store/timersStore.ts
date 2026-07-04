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

/** Anything that elapsed less than this long ago still fires normally after a
 *  relaunch; older items are settled silently by the rehydrate sweep below. */
export const STALE_ALERT_GRACE_MS = 30_000;

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
    {
      name: 'dashboard-timers',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Settle alarms/timers that elapsed while the app was closed, so the
        // widget's tick doesn't fire a chime+toast burst for the whole backlog
        // on launch. Anything inside the grace window still fires normally.
        const cutoff = Date.now() - STALE_ALERT_GRACE_MS;
        let missed = 0;
        state.alarms = state.alarms.map((a) => {
          if (a.done || a.at >= cutoff) return a;
          missed += 1;
          return { ...a, done: true };
        });
        state.timers = state.timers.map((t) => {
          if (!t.running || t.endsAt == null || t.endsAt >= cutoff) return t;
          missed += 1;
          return { ...t, running: false, endsAt: null, remainingMs: 0 };
        });
        if (missed > 0) {
          window.electron?.notify?.(
            'Nishboard',
            `${missed} timer${missed === 1 ? '/alarm' : 's/alarms'} elapsed while the app was closed`,
          );
        }
      },
    },
  ),
);
