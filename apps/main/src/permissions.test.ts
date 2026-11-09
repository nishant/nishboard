import { describe, expect, it } from 'vitest';
import { decideDefaultPermission } from './permissions';

describe('decideDefaultPermission', () => {
  it('allows clipboard write and fullscreen for the app, local server and embed hosts', () => {
    expect(decideDefaultPermission('clipboard-sanitized-write', 'app://nishboard/index.html', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'app://nishboard/index.html?widget=notes', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'http://localhost:7432/embed', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'http://127.0.0.1:7432/embed', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'https://www.youtube-nocookie.com/embed/x', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'https://player.twitch.tv/?channel=x', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'https://clips.twitch.tv/embed', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'https://www.rainviewer.com/map.html', false)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'https://www.rainviewer.com', false)).toBe(true);
  });

  it('allows the Vite origin only in dev', () => {
    expect(decideDefaultPermission('fullscreen', 'http://localhost:5173/', true)).toBe(true);
    expect(decideDefaultPermission('fullscreen', 'http://localhost:5173/', false)).toBe(false);
  });

  it('denies every other permission, even for allowed origins', () => {
    for (const p of ['openExternal', 'media', 'notifications', 'geolocation', 'midi', 'idle-detection']) {
      expect(decideDefaultPermission(p, 'app://nishboard/index.html', false)).toBe(false);
    }
  });

  it('denies other origins, lookalikes, http embeds and missing or bad URLs', () => {
    expect(decideDefaultPermission('fullscreen', 'https://evil.com', false)).toBe(false);
    expect(decideDefaultPermission('fullscreen', 'https://player.twitch.tv.evil.com/', false)).toBe(false);
    expect(decideDefaultPermission('fullscreen', 'http://player.twitch.tv/', false)).toBe(false);
    expect(decideDefaultPermission('fullscreen', 'http://localhost:9999/', false)).toBe(false);
    expect(decideDefaultPermission('fullscreen', 'app://other/index.html', false)).toBe(false);
    expect(decideDefaultPermission('fullscreen', undefined, false)).toBe(false);
    expect(decideDefaultPermission('fullscreen', 'not a url', false)).toBe(false);
  });
});
