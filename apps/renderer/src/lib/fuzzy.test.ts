import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('returns 0 for an empty query and -1 when the query is longer than the text', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('longer', 'log')).toBe(-1);
  });

  it('requires every query char in order (subsequence)', () => {
    expect(fuzzyScore('mkt', 'Markets')).toBeGreaterThan(0);
    expect(fuzzyScore('ba', 'ab')).toBe(-1); // right chars, wrong order
    expect(fuzzyScore('xyz', 'Markets')).toBe(-1);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('MKT', 'markets')).toBeGreaterThan(0);
    expect(fuzzyScore('mkt', 'MARKETS')).toBeGreaterThan(0);
  });

  it('ranks an exact/tight match above a scattered one', () => {
    expect(fuzzyScore('markets', 'Markets')).toBeGreaterThan(fuzzyScore('mkt', 'Markets'));
    expect(fuzzyScore('mkt', 'Markets')).toBeGreaterThan(fuzzyScore('mkt', 'Make it to work'));
  });

  it('rewards word-start hits (palette verbs match their command)', () => {
    // "os" hitting "Open Settings" word starts should beat mid-word hits.
    expect(fuzzyScore('os', 'Open Settings')).toBeGreaterThan(fuzzyScore('os', 'ghosts'));
  });
});
