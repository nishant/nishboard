import { describe, expect, it } from 'vitest';
import {
  discordUserAgent,
  isAllowedDiscordUrl,
  decideDiscordPermission,
  serializeShareSources,
} from './discord';
import type { CapturerSourceLike } from './discord';

describe('discordUserAgent', () => {
  it('builds a clean Chrome UA with no Electron or app-name tokens', () => {
    const ua = discordUserAgent('win32', '130.0.6723.137');
    expect(ua).toContain('Chrome/130.0.6723.137');
    expect(ua).toContain('Windows NT 10.0; Win64; x64');
    expect(ua).not.toMatch(/Electron/i);
    expect(ua).not.toMatch(/Nishboard/i);
  });

  it('uses the macOS token on darwin', () => {
    expect(discordUserAgent('darwin', '130.0.0.0')).toContain('Macintosh; Intel Mac OS X 10_15_7');
  });
});

describe('isAllowedDiscordUrl', () => {
  it('allows discord.com and subdomains over https', () => {
    expect(isAllowedDiscordUrl('https://discord.com/app')).toBe(true);
    expect(isAllowedDiscordUrl('https://discord.com/channels/@me')).toBe(true);
    expect(isAllowedDiscordUrl('https://ptb.discord.com/app')).toBe(true);
  });

  it('rejects http, lookalike hosts, and garbage', () => {
    expect(isAllowedDiscordUrl('http://discord.com/app')).toBe(false);
    // A prefix check would pass this — the URL parse must not.
    expect(isAllowedDiscordUrl('https://discord.com.evil.com/app')).toBe(false);
    expect(isAllowedDiscordUrl('https://evildiscord.com/app')).toBe(false);
    expect(isAllowedDiscordUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedDiscordUrl('not a url')).toBe(false);
    expect(isAllowedDiscordUrl('')).toBe(false);
  });
});

describe('decideDiscordPermission', () => {
  it('allows the media/notification set for discord origins', () => {
    expect(decideDiscordPermission('media', 'https://discord.com/channels/@me')).toBe(true);
    expect(decideDiscordPermission('display-capture', 'https://discord.com/app')).toBe(true);
    expect(decideDiscordPermission('notifications', 'https://ptb.discord.com')).toBe(true);
    expect(decideDiscordPermission('clipboard-sanitized-write', 'https://discord.com')).toBe(true);
    expect(decideDiscordPermission('fullscreen', 'https://discord.com')).toBe(true);
  });

  it('denies unlisted permissions even for discord, and everything for other origins', () => {
    expect(decideDiscordPermission('geolocation', 'https://discord.com/app')).toBe(false);
    expect(decideDiscordPermission('openExternal', 'https://discord.com/app')).toBe(false);
    expect(decideDiscordPermission('media', 'https://evil.com')).toBe(false);
    expect(decideDiscordPermission('media', 'https://discord.com.evil.com')).toBe(false);
  });
});

describe('serializeShareSources', () => {
  const img = (uri: string, empty = false) => ({ toDataURL: () => uri, isEmpty: () => empty });

  it('maps sources to data-URI shapes and derives kind from the id prefix', () => {
    const sources: CapturerSourceLike[] = [
      { id: 'screen:0:0', name: 'Screen 1', thumbnail: img('data:thumb1'), appIcon: null },
      { id: 'window:123:0', name: 'Notepad', thumbnail: img('data:thumb2'), appIcon: img('data:icon') },
    ];
    expect(serializeShareSources(sources)).toEqual([
      { id: 'screen:0:0', name: 'Screen 1', kind: 'screen', thumbnail: 'data:thumb1' },
      { id: 'window:123:0', name: 'Notepad', kind: 'window', thumbnail: 'data:thumb2', appIcon: 'data:icon' },
    ]);
  });

  it('drops empty appIcons', () => {
    const [out] = serializeShareSources([
      { id: 'window:9:0', name: 'W', thumbnail: img('data:t'), appIcon: img('data:x', true) },
    ]);
    expect(out.appIcon).toBeUndefined();
  });
});
