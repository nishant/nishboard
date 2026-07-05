import { useEffect } from 'react';
import { useWeather, useActiveWeatherZip } from '../widgets/weather/useWeather';
import { useAppSettingsStore } from '../store/settingsStore';
import { fireAlert } from '../lib/alerts';

// Module-level so remounts (StrictMode, HMR) don't re-fire. In-memory on
// purpose — after a restart the first fetch re-seeds silently, so persistence
// could only cause wrong fires or wrong suppressions.
const seenIds = new Set<string>();
// A zip's first payload seeds silently: pre-existing alerts at launch — or on
// first visit to a newly cycled zip — are ambient state, not news.
const seededZips = new Set<string>();
const SEEN_CAP = 300;

function alertKey(a: { id?: string; event: string; headline: string }): string {
  // Warm pre-upgrade caches can hand back id-less alerts right after update.
  return a.id ?? `${a.event}|${a.headline}`;
}

/**
 * Headless, mounted in App: pushes NEW NWS alerts through fireAlert
 * (chime + toast + native notification), gated by the weatherAlertNotify
 * setting. Observes the same weather query as the widget (same key → deduped);
 * with the setting off it forces no polling at all.
 */
export function WeatherAlertNotifier() {
  const mode = useAppSettingsStore((s) => s.weatherAlertNotify);
  const zip = useActiveWeatherZip();
  const { data } = useWeather(mode !== 'off');

  useEffect(() => {
    if (mode === 'off' || !data) return;
    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    const zipKey = zip || 'auto';

    if (!seededZips.has(zipKey)) {
      seededZips.add(zipKey);
      for (const a of alerts) seenIds.add(alertKey(a));
      return;
    }

    for (const a of alerts) {
      const key = alertKey(a);
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      if (mode === 'severe' && a.severity !== 'Extreme' && a.severity !== 'Severe') continue;
      fireAlert(a.event, a.headline || a.event);
    }

    // Cap the set — drop oldest (Sets iterate in insertion order).
    if (seenIds.size > SEEN_CAP) {
      for (const key of seenIds) {
        if (seenIds.size <= SEEN_CAP) break;
        seenIds.delete(key);
      }
    }
  }, [data, mode, zip]);

  return null;
}
