import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

function seed() {
  localStorage.setItem(
    'dashboard-countdown',
    JSON.stringify({
      state: { events: [{ id: 'e', label: 'old', at: Date.now() - 10 * 60_000, notified: false }] },
      version: 0,
    }),
  );
}

function setElectron(notify: () => void) {
  (window as unknown as { electron?: unknown }).electron = { notify };
}

describe('countdownStore rehydrate sweep', () => {
  it('settles past events in memory AND in localStorage, and notifies once', async () => {
    seed();
    const notify = vi.fn();
    setElectron(notify);
    const { useCountdownStore } = await import('./countdownStore');
    expect(useCountdownStore.getState().events[0].notified).toBe(true);
    await Promise.resolve();
    expect(JSON.parse(localStorage.getItem('dashboard-countdown')!).state.events[0].notified).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);

    vi.resetModules();
    await import('./countdownStore');
    expect(notify).toHaveBeenCalledTimes(1);
    delete (window as unknown as { electron?: unknown }).electron;
  });

  it('does nothing in a popout window', async () => {
    seed();
    window.history.replaceState({}, '', '/?widget=countdown');
    const notify = vi.fn();
    setElectron(notify);
    const { useCountdownStore } = await import('./countdownStore');
    expect(useCountdownStore.getState().events[0].notified).toBe(false);
    expect(notify).not.toHaveBeenCalled();
    delete (window as unknown as { electron?: unknown }).electron;
  });
});
