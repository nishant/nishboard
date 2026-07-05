import { useAppSettingsStore } from '../store/settingsStore';
import { usePowerStore } from '../store/powerStore';

/** Multiplier applied to every poll interval while low-power is engaged. */
export const LOW_POWER_SLOWDOWN = 4;

/**
 * Poll gate for TanStack Query's `refetchInterval`:
 * - window hidden (minimized / behind the tray) → `false` — polling pauses
 *   entirely; the visibility kicker in App refetches stale queries on return.
 * - low-power engaged (setting 'on', or 'auto' while on battery) → base × 4.
 * - otherwise → the base interval unchanged.
 */
export function useGatedInterval(baseMs: number): number | false {
  const hidden = usePowerStore((s) => s.hidden);
  const onBattery = usePowerStore((s) => s.onBattery);
  const lowPower = useAppSettingsStore((s) => s.lowPower);
  if (hidden) return false;
  const low = lowPower === 'on' || (lowPower === 'auto' && onBattery);
  return low ? baseMs * LOW_POWER_SLOWDOWN : baseMs;
}

/**
 * Poll gate for alert evaluation: unlike `useGatedInterval`, a hidden window
 * SLOWS polling (×4) instead of stopping it — alerts exist precisely for when
 * the dashboard is minimized/behind the tray, where `fireAlert`'s native
 * notification is the payoff. Low-power applies the same ×4 (not stacked ×16;
 * hidden and low-power both mean "be gentle", not "be gentler twice").
 */
export function useAlertGatedInterval(baseMs: number): number {
  const hidden = usePowerStore((s) => s.hidden);
  const onBattery = usePowerStore((s) => s.onBattery);
  const lowPower = useAppSettingsStore((s) => s.lowPower);
  const low = lowPower === 'on' || (lowPower === 'auto' && onBattery);
  return hidden || low ? baseMs * LOW_POWER_SLOWDOWN : baseMs;
}
