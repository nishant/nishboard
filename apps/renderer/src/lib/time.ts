// Shared time/duration formatters — consolidates per-widget copies
// (Spotify fmtMs ×2, Stocks/News relTime ×2, Timer fmtDur, Countdown
// fmtRemaining, Hardware fmtUptime). Locale-specific one-offs stay local.

/** m:ss — track positions/durations. */
export function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** h:mm:ss (or m:ss under an hour), ceiling seconds — countdown-style timers. */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Adaptive "2d 4h" / "3h 12m" / "5m 30s" / "42s" — long countdowns. */
export function fmtRemaining(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Past-oriented "5m ago" / "2h ago" / "3d ago" from an ISO timestamp. */
export function relTimeAgo(iso: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Future-oriented "in 5m" / "in 2h 30m" / "in 3d 4h" to a timestamp. */
export function relTimeUntil(at: number, now: number): string {
  const ms = at - now;
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Intl options fragment for the user's clock-format setting — spread into
 *  DateTimeFormat options wherever a wall-clock time is displayed.
 *  `h23` (not `hour12: false`) so midnight renders "00", never "24". */
export function hourFormat(clock24h: boolean): Intl.DateTimeFormatOptions {
  return clock24h ? { hourCycle: 'h23' } : { hour12: true };
}

/** "3d 4h 12m" / "4h 12m" / "12m" from seconds — system uptime. */
export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
