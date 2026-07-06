// Pure, dependency-free argument parsers for the command palette's
// parameterized commands ("timer 25m tea", "alarm 7:30pm", "countdown 12/25").
// Parsers only read the ambient clock (Date.now) — no store or DOM access.

/**
 * Parse a human duration into milliseconds.
 *
 * Grammar (case-insensitive, whitespace-tolerant):
 *   colon    := H ":" MM ":" SS | M ":" SS      — "1:30:00" = 1h 30m, "1:30" = 1m 30s
 *   compound := (NUMBER UNIT)+                  — "1h5m3s", "1h 5m", "90m", "45s", "1.5h", "25 min", "2 hours"
 *   bare     := NUMBER                          — minutes ("90" = 90 minutes)
 *   UNIT     := h|hr(s)|hour(s) | m|min(s)|minute(s) | s|sec(s)|second(s)
 *   NUMBER   := digits, optional decimal ("1.5")
 *
 * Anything under one second (including "0m") or unparseable → null.
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // Colon notation: two parts = m:ss, three = h:mm:ss.
  const colon = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    if (b >= 60) return null;
    let ms: number;
    if (colon[3] !== undefined) {
      const c = Number(colon[3]);
      if (c >= 60) return null;
      ms = ((a * 60 + b) * 60 + c) * 1000;
    } else {
      ms = (a * 60 + b) * 1000;
    }
    return ms >= 1000 ? ms : null;
  }

  // Bare number = minutes.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const ms = Math.round(Number(s) * 60_000);
    return ms >= 1000 ? ms : null;
  }

  // Compound unit run — the whole string must be consumed (sticky regex walk),
  // so trailing garbage ("5m tea") rejects and the caller can split a label off.
  const seg = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\s*/y;
  let idx = 0;
  let total = 0;
  while (idx < s.length) {
    seg.lastIndex = idx;
    const m = seg.exec(s);
    if (!m) return null;
    const unitMs = m[2].startsWith('h') ? 3_600_000 : m[2].startsWith('s') ? 1000 : 60_000;
    total += Number(m[1]) * unitMs;
    idx = seg.lastIndex;
  }
  const ms = Math.round(total);
  return ms >= 1000 ? ms : null;
}

/**
 * Parse a wall-clock time of day.
 *
 * Grammar (case-insensitive):
 *   time     := HOUR [":" MINUTE] [WS] [MERIDIEM]   — "7", "7am", "7:30", "7:30pm", "19:05"
 *   HOUR     := 1–2 digits; 1–12 with a meridiem, 0–23 without
 *   MINUTE   := exactly 2 digits, 00–59
 *   MERIDIEM := am | pm | a | p
 */
export function parseTimeOfDay(input: string): { h: number; m: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(input.trim().toLowerCase());
  if (!match) return null;
  let h = Number(match[1]);
  const m = match[2] !== undefined ? Number(match[2]) : 0;
  if (m > 59) return null;
  if (match[3] !== undefined) {
    if (h < 1 || h > 12) return null;
    if (h === 12) h = 0; // 12am = 00, 12pm = 12 (after the pm shift below)
    if (match[3].startsWith('p')) h += 12;
  } else if (h > 23) {
    return null;
  }
  return { h, m };
}

/** Epoch ms of the next h:m — today if still ahead, otherwise tomorrow. */
export function nextOccurrence(h: number, m: number): number {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Parse a calendar date (with optional trailing time) into epoch ms (local).
 *
 * Grammar:
 *   date := (M "/" D ["/" YYYY] | YYYY "-" M "-" D) [WS time]
 *   time := see parseTimeOfDay — omitted = midnight
 *
 * MM/DD without a year resolves to the next occurrence (rolls into next year
 * once this year's instant has passed). Impossible dates (2/30, 2/29 in a
 * non-leap year) → null.
 */
export function parseDateArg(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  const [dateToken, ...timeTokens] = s.split(/\s+/);
  let h = 0;
  let m = 0;
  if (timeTokens.length > 0) {
    const tod = parseTimeOfDay(timeTokens.join(' '));
    if (!tod) return null;
    h = tod.h;
    m = tod.m;
  }

  const slash = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(dateToken);
  if (slash) {
    const mo = Number(slash[1]);
    const day = Number(slash[2]);
    if (slash[3] !== undefined) return buildLocalDate(Number(slash[3]), mo, day, h, m);
    // Year omitted: next occurrence. (2/29 validates against the current year,
    // so it only parses when that year is a leap year.)
    const year = new Date().getFullYear();
    const thisYear = buildLocalDate(year, mo, day, h, m);
    if (thisYear === null) return null;
    return thisYear > Date.now() ? thisYear : buildLocalDate(year + 1, mo, day, h, m);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dateToken);
  if (iso) return buildLocalDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), h, m);
  return null;
}

/** Local y/mo/d h:m, rejecting values the Date constructor would roll over. */
function buildLocalDate(y: number, mo: number, d: number, h: number, m: number): number | null {
  const dt = new Date(y, mo - 1, d, h, m, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt.getTime() : null;
}
