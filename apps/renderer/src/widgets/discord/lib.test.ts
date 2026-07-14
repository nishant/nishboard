import { describe, expect, it } from 'vitest';
import { parseDiscordUnreadCount } from './lib';

describe('parseDiscordUnreadCount', () => {
  it('extracts the mention count prefix', () => {
    expect(parseDiscordUnreadCount('(3) Discord | #general | My Server')).toBe(3);
    expect(parseDiscordUnreadCount('(12) Discord')).toBe(12);
    expect(parseDiscordUnreadCount('  (1) Discord | Friends')).toBe(1);
  });

  it('returns 0 when there is no count', () => {
    expect(parseDiscordUnreadCount('Discord | Friends')).toBe(0);
    // "•" marks unread-without-mentions — deliberately not badged.
    expect(parseDiscordUnreadCount('• Discord | #general')).toBe(0);
    expect(parseDiscordUnreadCount('')).toBe(0);
    expect(parseDiscordUnreadCount('Server (3) Discord')).toBe(0);
  });
});
