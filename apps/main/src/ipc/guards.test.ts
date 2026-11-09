import { describe, expect, it } from 'vitest';
import { isAllowedExternalUrl, isAuthUrl, isValidPopoutId } from './guards';

describe('isAllowedExternalUrl', () => {
  it('allows http and https links only', () => {
    expect(isAllowedExternalUrl('https://example.com/a?b=1')).toBe(true);
    expect(isAllowedExternalUrl('HTTP://example.com')).toBe(true);
    for (const bad of ['file:///C:/Windows/System32/calc.exe', 'ms-msdt:/id', 'javascript:alert(1)', 'app://nishboard/x', ' https://x.com', 'example.com', '']) {
      expect(isAllowedExternalUrl(bad)).toBe(false);
    }
  });
  it('rejects non-strings instead of throwing', () => {
    for (const bad of [undefined, null, 5, {}, ['https://x.com']]) expect(isAllowedExternalUrl(bad)).toBe(false);
  });
});

describe('isAuthUrl', () => {
  it('accepts only each provider identity host', () => {
    expect(isAuthUrl('spotify', 'https://accounts.spotify.com/authorize?x=1')).toBe(true);
    expect(isAuthUrl('twitch', 'https://id.twitch.tv/oauth2/authorize')).toBe(true);
    expect(isAuthUrl('youtube', 'https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
    expect(isAuthUrl('google', 'https://accounts.google.com/o/oauth2/v2/auth')).toBe(true);
  });
  it('rejects other hosts, lookalikes, http and another service host', () => {
    expect(isAuthUrl('spotify', 'https://accounts.spotify.com.evil.com/')).toBe(false);
    expect(isAuthUrl('spotify', 'http://accounts.spotify.com/')).toBe(false);
    expect(isAuthUrl('spotify', 'https://accounts.google.com/')).toBe(false);
    expect(isAuthUrl('twitch', 'https://id.twitch.tv.evil.com/')).toBe(false);
    expect(isAuthUrl('google', 'https://evil.com/https://accounts.google.com/')).toBe(false);
  });
  it('rejects non-strings instead of throwing', () => {
    for (const bad of [undefined, null, 5, {}]) expect(isAuthUrl('spotify', bad)).toBe(false);
  });
});

describe('isValidPopoutId', () => {
  it('accepts lowercase slugs of 2-20 letters', () => {
    expect(isValidPopoutId('notes')).toBe(true);
    expect(isValidPopoutId('ab')).toBe(true);
    expect(isValidPopoutId('a'.repeat(20))).toBe(true);
  });
  it('rejects everything else', () => {
    for (const bad of ['a', 'a'.repeat(21), 'Notes', 'a-b', 'a1', '../x', 'a\nb', '', undefined, 7]) {
      expect(isValidPopoutId(bad)).toBe(false);
    }
  });
});
