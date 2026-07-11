import { describe, expect, it } from 'vitest';
import { parseUsageResponse } from './claudeUsage';

// Pure response-mapping tests only — no network, no keychain.

describe('parseUsageResponse', () => {
  it('maps known windows with labels, ordered session-first', () => {
    const data = parseUsageResponse({
      seven_day: { utilization: 12, resets_at: '2026-07-14T00:00:00Z' },
      five_hour: { utilization: 34.5, resets_at: '2026-07-10T21:00:00Z' },
    });
    expect(data.windows.map((w) => w.key)).toEqual(['five_hour', 'seven_day']);
    expect(data.windows[0]).toEqual({
      key: 'five_hour',
      label: 'Session (5h)',
      utilization: 34.5,
      resetsAt: '2026-07-10T21:00:00Z',
    });
    expect(data.windows[1].label).toBe('Weekly — all models');
  });

  it('keeps unknown windows with a prettified key (forward-compatible)', () => {
    const data = parseUsageResponse({
      brand_new_window: { utilization: 5, resets_at: null },
    });
    expect(data.windows).toEqual([
      { key: 'brand_new_window', label: 'brand new window', utilization: 5, resetsAt: null },
    ]);
  });

  it('clamps utilization to 0–100 and skips non-window values', () => {
    const data = parseUsageResponse({
      five_hour: { utilization: 250, resets_at: 7 },
      seven_day: { utilization: -3 },
      note: 'string value',
      broken: { utilization: 'high' },
      nullish: null,
    });
    expect(data.windows).toEqual([
      { key: 'five_hour', label: 'Session (5h)', utilization: 100, resetsAt: null },
      { key: 'seven_day', label: 'Weekly — all models', utilization: 0, resetsAt: null },
    ]);
  });

  it('non-object bodies → empty windows', () => {
    expect(parseUsageResponse(null).windows).toEqual([]);
    expect(parseUsageResponse('nope').windows).toEqual([]);
    expect(parseUsageResponse([1, 2]).windows).toEqual([]);
  });
});
