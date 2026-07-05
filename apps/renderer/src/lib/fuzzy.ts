// Dependency-free fuzzy subsequence scorer for the command palette.
// Every query char must appear in order in the text (case-insensitive);
// score rewards consecutive runs and word-start hits, with a light length
// normalization so "mkt" ranks "Markets" over "Make timer … kt…".

const WORD_BOUNDARY = /[\s\-_/:.]/;

/** Higher = better match; -1 = not a subsequence match at all. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  if (q.length > t.length) return -1;

  let score = 0;
  let ti = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const idx = t.indexOf(q[qi], ti);
    if (idx === -1) return -1;
    score += 1;
    if (idx === prevMatch + 1) score += 2; // consecutive run
    if (idx === 0 || WORD_BOUNDARY.test(t[idx - 1])) score += 3; // word start
    prevMatch = idx;
    ti = idx + 1;
  }
  // Prefer tighter matches in shorter strings.
  return score + Math.max(0, 10 - (prevMatch - t.indexOf(q[0]))) / 10 + Math.max(0, 20 - t.length) / 40;
}
