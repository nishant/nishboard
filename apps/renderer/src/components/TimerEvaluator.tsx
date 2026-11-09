import { useEffect } from 'react';
import { useTimersStore, STALE_ALERT_GRACE_MS } from '../store/timersStore';
import { useCountdownStore } from '../store/countdownStore';
import { fireAlert } from '../lib/alerts';

/** Exported for tests. Fires every due timer, alarm and countdown once. Items
 *  that elapsed more than the grace window ago (a throttled or slept window)
 *  are settled and summarised in one alert instead of chimed one by one. */
export function sweepDueAlerts(now: number): void {
  const timers = useTimersStore.getState();
  const countdowns = useCountdownStore.getState();
  const cutoff = now - STALE_ALERT_GRACE_MS;
  let late = 0;

  for (const t of timers.timers) {
    if (!t.running || t.endsAt == null || now < t.endsAt) continue;
    timers.finishTimer(t.id);
    if (t.endsAt < cutoff) late += 1;
    else fireAlert('Timer done', t.label || 'Your timer finished');
  }
  for (const a of timers.alarms) {
    if (a.done || now < a.at) continue;
    timers.markAlarmDone(a.id);
    if (a.at < cutoff) late += 1;
    else fireAlert('Alarm', a.label || 'Alarm');
  }
  for (const e of countdowns.events) {
    if (e.notified || now < e.at) continue;
    countdowns.markNotified(e.id);
    if (e.at < cutoff) late += 1;
    else fireAlert('Countdown', e.label || 'Event reached');
  }
  if (late > 0) {
    fireAlert('Missed alerts', `${late} timer${late === 1 ? '/alarm' : 's/alarms'} elapsed while the app was busy`);
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
