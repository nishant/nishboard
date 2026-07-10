import { describe, expect, it } from 'vitest';
import { parseIso8601Duration, isShortDuration } from './youtubeDuration';

describe('parseIso8601Duration', () => {
  it('parses hours/minutes/seconds combos', () => {
    expect(parseIso8601Duration('PT1M5S')).toBe(65);
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
    expect(parseIso8601Duration('PT45S')).toBe(45);
    expect(parseIso8601Duration('PT2H')).toBe(7200);
    expect(parseIso8601Duration('PT10M')).toBe(600);
    expect(parseIso8601Duration('PT1H30M')).toBe(5400);
  });

  it('parses PT0S as 0', () => {
    expect(parseIso8601Duration('PT0S')).toBe(0);
  });

  it('tolerates a leading day component', () => {
    expect(parseIso8601Duration('P1DT1H')).toBe(90000);
  });

  it('returns 0 for empty or malformed input', () => {
    expect(parseIso8601Duration('')).toBe(0);
    expect(parseIso8601Duration('garbage')).toBe(0);
    expect(parseIso8601Duration('1M5S')).toBe(0); // missing leading P
    expect(parseIso8601Duration('PT')).toBe(0);
  });
});

describe('isShortDuration', () => {
  it('treats a 60s video as a Short', () => {
    expect(isShortDuration(60)).toBe(true);
    expect(isShortDuration(1)).toBe(true);
    expect(isShortDuration(30)).toBe(true);
  });

  it('does not treat >60s as a Short', () => {
    expect(isShortDuration(61)).toBe(false);
    expect(isShortDuration(3723)).toBe(false);
  });

  it('does not treat 0 (unknown duration) as a Short', () => {
    expect(isShortDuration(0)).toBe(false);
  });
});
