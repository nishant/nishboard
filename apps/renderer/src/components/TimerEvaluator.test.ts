import { beforeEach, describe, expect, it, vi } from 'vitest';

const fireAlert = vi.fn();
vi.mock('../lib/alerts', () => ({ fireAlert: (t: string, b: string) => fireAlert(t, b) }));

import { sweepDueAlerts } from './TimerEvaluator';
import { useTimersStore } from '../store/timersStore';
import { useCountdownStore } from '../store/countdownStore';

const NOW = 1_000_000_000_000;

describe('sweepDueAlerts', () => {
  beforeEach(() => {
    fireAlert.mockClear();
    useTimersStore.setState({ timers: [], alarms: [] });
    useCountdownStore.setState({ events: [] });
  });

  it('fires a due alarm and countdown once', () => {
    useTimersStore.setState({ alarms: [{ id: 'a', label: 'wake', at: NOW - 1000, done: false }] });
    useCountdownStore.setState({ events: [{ id: 'e', label: 'trip', at: NOW - 500, notified: false }] });
    sweepDueAlerts(NOW);
    sweepDueAlerts(NOW + 500);
    expect(fireAlert).toHaveBeenCalledTimes(2);
    expect(fireAlert).toHaveBeenCalledWith('Alarm', 'wake');
    expect(fireAlert).toHaveBeenCalledWith('Countdown', 'trip');
  });

  it('summarises a stale backlog instead of chiming each item', () => {
    useTimersStore.setState({
      alarms: [
        { id: 'a', label: 'x', at: NOW - 3_600_000, done: false },
        { id: 'b', label: 'y', at: NOW - 7_200_000, done: false },
      ],
    });
    sweepDueAlerts(NOW);
    expect(fireAlert).toHaveBeenCalledTimes(1);
    expect(fireAlert.mock.calls[0]?.[0]).toBe('Missed alerts');
    expect(useTimersStore.getState().alarms.every((a) => a.done)).toBe(true);
    expect(fireAlert.mock.calls[0]?.[1]).toContain('x, y');
  });

  it('fires a throttled alarm (45s late) with its own label', () => {
    useTimersStore.setState({ alarms: [{ id: 'a', label: 'wake up', at: NOW - 45_000, done: false }] });
    sweepDueAlerts(NOW);
    expect(fireAlert).toHaveBeenCalledWith('Alarm', 'wake up');
  });
});
