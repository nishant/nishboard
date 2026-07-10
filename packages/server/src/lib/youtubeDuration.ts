/** ISO-8601 duration → seconds. YouTube's contentDetails.duration only ever
 *  emits the time part (e.g. `PT1M5S`, `PT1H2M3S`, `PT45S`, `PT0S`) — no
 *  day/week/month components in practice. We still tolerate a leading `PnD`
 *  before the `T`. Anything malformed/empty → 0. */
export function parseIso8601Duration(iso: string): number {
  if (!iso) return 0;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const days = Number(m[1] ?? 0);
  const hours = Number(m[2] ?? 0);
  const minutes = Number(m[3] ?? 0);
  const seconds = Number(m[4] ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/** Shorts heuristic: a real, non-zero duration of at most 60s. YouTube exposes
 *  no official "isShort" flag, so callers OR this with a `#shorts` title check. */
export function isShortDuration(seconds: number): boolean {
  return seconds > 0 && seconds <= 60;
}
