import { useEffect } from 'react';
import { useTwitchAuthStatus, useTwitchFollowed, TWITCH_FOLLOWED_POLL_MS } from '../widgets/twitch/useTwitch';
import { useAppSettingsStore } from '../store/settingsStore';
import { useAlertGatedInterval } from '../hooks/useGatedInterval';
import { fireAlert } from '../lib/alerts';

// Module-level so remounts (StrictMode, HMR) don't re-fire — same pattern as
// WeatherAlertNotifier. In-memory on purpose: after a restart the first fetch
// re-seeds silently, so persistence could only cause wrong fires.
let seeded = false;
// `${id}:${startedAt}` of every stream already seen: one stream is one key, so
// top-20 churn (a channel dropping out of the page and back in) cannot re-fire.
const seen = new Set<string>();
const SEEN_CAP = 500;
// When the previous successful poll was processed (ms).
let lastPollAt = 0;
// The payload last processed, so a changed interval or setting re-running the effect is not a new poll.
let lastData: unknown = null;

function resetNotifierState(): void {
  seeded = false;
  seen.clear();
  lastPollAt = 0;
  lastData = null;
}

/**
 * Headless, mounted in App: fires a chime + toast + native notification when a
 * followed Twitch channel GOES live, gated by the twitchLiveNotify setting.
 * Observes the same /followed query as the widget's Live tab (same key →
 * deduped); channels already live at launch are ambient state, not news. A
 * channel fires only if its stream is not seen yet AND started after the
 * previous poll minus two poll intervals, so a long-running stream that
 * re-enters the list (or a catch-up poll after the window was hidden) stays quiet.
 */
export function TwitchLiveNotifier() {
  const enabled = useAppSettingsStore((s) => s.twitchLiveNotify);
  const authed = useTwitchAuthStatus().data?.authenticated === true;
  // Same base as the widget's poll, but a hidden window slows it instead of stopping it.
  const interval = useAlertGatedInterval(TWITCH_FOLLOWED_POLL_MS);
  const { data } = useTwitchFollowed(enabled && authed, interval);

  useEffect(() => {
    if (!enabled || !authed) {
      // Turned off or disconnected: whatever goes live meanwhile is not news on return.
      resetNotifierState();
      return;
    }
    if (!data || data === lastData) return;
    lastData = data;

    const now = Date.now();
    if (seeded) {
      const cutoff = lastPollAt - 2 * interval;
      for (const c of data.items) {
        const key = `${c.id}:${c.startedAt ?? ''}`;
        if (seen.has(key)) continue;
        const started = c.startedAt ? Date.parse(c.startedAt) : NaN;
        if (Number.isFinite(started) && started > cutoff) {
          fireAlert(`${c.displayName} is live`, c.gameName || c.title || 'Streaming now');
        }
      }
    }
    seeded = true;
    lastPollAt = now;

    for (const c of data.items) seen.add(`${c.id}:${c.startedAt ?? ''}`);
    // Cap the set — drop oldest (Sets iterate in insertion order).
    for (const key of seen) {
      if (seen.size <= SEEN_CAP) break;
      seen.delete(key);
    }
  }, [data, enabled, authed, interval]);

  return null;
}
