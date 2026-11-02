import { describe, expect, it } from 'vitest';
import { fillThumb, mapCategory, parseDuration } from './twitchHelix';

describe('fillThumb', () => {
  it('fills both template styles and forces https', () => {
    expect(fillThumb('https://x.test/a-{width}x{height}.jpg', 320, 180)).toBe('https://x.test/a-320x180.jpg');
    expect(fillThumb('http://x.test/a-%{width}x%{height}.jpg', 320, 180)).toBe('https://x.test/a-320x180.jpg');
  });
  it('drops non-http(s) and missing URLs', () => {
    expect(fillThumb('javascript:alert(1)', 1, 1)).toBe('');
    expect(fillThumb(undefined, 1, 1)).toBe('');
  });
});

describe('parseDuration', () => {
  it('parses h/m/s', () => {
    expect(parseDuration('1h2m3s')).toBe(3723);
    expect(parseDuration('45s')).toBe(45);
    expect(parseDuration('garbage')).toBe(0);
    expect(parseDuration(undefined)).toBe(0);
  });
});

describe('mapCategory', () => {
  it('rewrites pre-sized box art and fills templates', () => {
    expect(mapCategory({ id: '1', name: 'A', box_art_url: 'https://x.test/a-52x72.jpg' }).boxArtUrl)
      .toBe('https://x.test/a-144x192.jpg');
    expect(mapCategory({ id: '2', name: 'B', box_art_url: 'https://x.test/b-{width}x{height}.jpg' }).boxArtUrl)
      .toBe('https://x.test/b-144x192.jpg');
  });
});
