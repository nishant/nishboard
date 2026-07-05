import { useEffect } from 'react';
import { useTwitchAuthStatus, useTwitchFollowed } from '../widgets/twitch/useTwitch';
import { useAppSettingsStore } from '../store/settingsStore';
import { fireAlert } from '../lib/alerts';

// Module-level so remounts (StrictMode, HMR) don't re-fire — same pattern as
// WeatherAlertNotifier. In-memory on purpose: after a restart the first fetch
// re-seeds silently, so persistence could only cause wrong fires.
let seeded = false;
const liveNow = new Set<string>();

/**
 * Headless, mounted in App: fires a chime + toast + native notification when a
 * followed Twitch channel GOES live, gated by the twitchLiveNotify setting.
 * Observes the same /followed query as the widget's Live tab (same key →
 * deduped); channels already live at launch are ambient state, not news.
 */
export function TwitchLiveNotifier() {
  const enabled = useAppSettingsStore((s) => s.twitchLiveNotify);
  const authed = useTwitchAuthStatus().data?.authenticated === true;
  const { data } = useTwitchFollowed(enabled && authed);

  useEffect(() => {
    if (!enabled || !data) return;

    if (seeded) {
      for (const c of data.items) {
        if (!liveNow.has(c.id)) {
          fireAlert(`${c.displayName} is live`, c.gameName || c.title || 'Streaming now');
        }
      }
    }
    seeded = true;

    // Replace (don't accumulate): a channel that goes offline drops out, so a
    // later re-live notifies again.
    liveNow.clear();
    for (const c of data.items) liveNow.add(c.id);
  }, [data, enabled]);

  return null;
}
