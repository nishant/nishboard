import { useEffect } from 'react';
import { useTimersStore } from '../store/timersStore';
import { useCountdownStore } from '../store/countdownStore';
import { fireAlert } from '../lib/alerts';

/** Live-loop grace. Much wider than the launch sweep's 30s so a throttled
 *  timer (up to ~1 min late) still fires with its own label; only a real
 *  backlog (sleep, long stall) is summarised. */
export const LIVE_ALERT_GRACE_MS = 5 * 60_000;

/** Exported for tests. Fires every due timer, alarm and countdown once. Items
 *  that elapsed more than the grace window ago (a slept window) are settled
 *  and summarised in one alert, with their labels, instead of chimed one by one. */
export function sweepDueAlerts(now: number, graceMs: number = LIVE_ALERT_GRACE_MS): void {
  const timers = useTimersStore.getState();
  const countdowns = useCountdownStore.getState();
  const cutoff = now - graceMs;
  const late: string[] = [];

  for (const t of timers.timers) {
    if (!t.running || t.endsAt == null || now < t.endsAt) continue;
    timers.finishTimer(t.id);
    if (t.endsAt < cutoff) late.push(t.label || 'Timer');
    else fireAlert('Timer done', t.label || 'Your timer finished');
  }
  for (const a of timers.alarms) {
    if (a.done || now < a.at) continue;
    timers.markAlarmDone(a.id);
    if (a.at < cutoff) late.push(a.label || 'Alarm');
    else fireAlert('Alarm', a.label || 'Alarm');
  }
  for (const e of countdowns.events) {
    if (e.notified || now < e.at) continue;
    countdowns.markNotified(e.id);
    if (e.at < cutoff) late.push(e.label || 'Countdown');
    else fireAlert('Countdown', e.label || 'Event reached');
  }
  if (late.length > 0) {
    fireAlert('Missed alerts', `${late.length} missed while the app was asleep or busy: ${late.join(', ')}`);
  }
}

/**
 * Headless scheduler for timers, alarms and countdowns, mounted once in the
 * MAIN window only (never a popout, which would double-fire). The widgets just
 * render, so a collapsed, unpinned or popped-out Timer/Countdown tile still
 * rings. Popouts see the result through the cross-window store sync.
 */
export function TimerEvaluator() {
  useEffect(() => {
    const id = setInterval(() => sweepDueAlerts(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  return null;
}
