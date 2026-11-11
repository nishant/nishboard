import { describe, expect, it } from 'vitest';
import { stripFrameAncestors } from './cspStrip';

describe('stripFrameAncestors', () => {
  it('drops only frame-ancestors', () => {
    expect(stripFrameAncestors("default-src 'self'; frame-ancestors http://localhost:*; img-src *"))
      .toBe("default-src 'self'; img-src *");
  });

  it('is case-insensitive and handles a trailing directive', () => {
    expect(stripFrameAncestors("script-src 'self'; Frame-Ancestors *")).toBe("script-src 'self'");
  });

  it('leaves a policy without it unchanged', () => {
    expect(stripFrameAncestors("default-src 'self'")).toBe("default-src 'self'");
  });

  it('does not match a directive that merely starts with the name', () => {
    expect(stripFrameAncestors('frame-ancestors-x a; b c')).toBe('frame-ancestors-x a; b c');
  });
});
