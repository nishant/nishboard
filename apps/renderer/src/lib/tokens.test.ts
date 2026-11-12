import { describe, expect, it } from 'vitest';
import { tk } from './tokens';

describe('tk', () => {
  it('returns a var() reference so the value follows theme switches', () => {
    expect(tk('accent')).toBe('var(--nish-accent)');
    expect(tk('chart-3')).toBe('var(--nish-chart-3)');
  });
});
