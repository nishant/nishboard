import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

const OLD = Date.now() - 10 * 60_000;

function seed() {
  localStorage.setItem(
    'dashboard-timers',
    JSON.stringify({
      state: {
        alarms: [{ id: 'a', label: 'old', at: OLD, done: false }],
        timers: [{ id: 't', label: 'old', durationMs: 1000, running: true, endsAt: OLD, remainingMs: 1000 }],
      },
      version: 0,
    }),
  );
}

function setElectron(notify: () => void) {
  (window as unknown as { electron?: unknown }).electron = { notify };
}

describe('timersStore rehydrate sweep', () => {
  it('settles past-due items in memory AND in localStorage, and notifies once', async () => {
    seed();
    const notify = vi.fn();
    setElectron(notify);
    const { useTimersStore } = await import('./timersStore');
    expect(useTimersStore.getState().alarms[0].done).toBe(true);
    expect(useTimersStore.getState().timers[0].running).toBe(false);
    await Promise.resolve();
    const stored = JSON.parse(localStorage.getItem('dashboard-timers')!);
    expect(stored.state.alarms[0].done).toBe(true);
    expect(stored.state.timers[0].running).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);

    // Next launch: nothing left to sweep, so no repeat notice.
    vi.resetModules();
    await import('./timersStore');
    expect(notify).toHaveBeenCalledTimes(1);
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('does nothing in a popout window', async () => {
    seed();
    window.history.replaceState({}, '', '/?widget=timer');
    const notify = vi.fn();
    setElectron(notify);
    const { useTimersStore } = await import('./timersStore');
    expect(useTimersStore.getState().alarms[0].done).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    delete (window as unknown as { electron?: unknown }).electron;
  });
});
