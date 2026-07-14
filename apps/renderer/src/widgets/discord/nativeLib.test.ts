import { describe, expect, it } from 'vitest';
import type { DiscordMessageData, DiscordSelectedVoiceData } from '@dash/shared';
import { MESSAGE_CAP, applyMessageEvent, applySpeaking, formatMessageTime, guildInitials } from './nativeLib';

function msg(id: string, content = ''): DiscordMessageData {
  return {
    id,
    channelId: 'c1',
    author: { id: 'u1', username: 'Nish', avatarUrl: null },
    content,
    timestamp: '2026-07-14T12:00:00.000Z',
    edited: false,
    attachmentCount: 0,
    hasEmbeds: false,
  };
}

describe('applyMessageEvent', () => {
  it('appends a create at the end', () => {
    const next = applyMessageEvent([msg('a')], { type: 'message', action: 'create', message: msg('b') });
    expect(next.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('dedupes a repeated create by replacing in place (stream reconnect replay)', () => {
    const next = applyMessageEvent([msg('a', 'old'), msg('b')], {
      type: 'message',
      action: 'create',
      message: msg('a', 'new'),
    });
    expect(next.map((m) => m.id)).toEqual(['a', 'b']);
    expect(next[0].content).toBe('new');
  });

  it('applies an update in place and drops updates for unloaded messages', () => {
    const updated = applyMessageEvent([msg('a', 'old')], {
      type: 'message',
      action: 'update',
      message: msg('a', 'edited'),
    });
    expect(updated[0].content).toBe('edited');

    const untouched = applyMessageEvent([msg('a')], {
      type: 'message',
      action: 'update',
      message: msg('zz'),
    });
    expect(untouched.map((m) => m.id)).toEqual(['a']);
  });

  it('removes on delete', () => {
    const next = applyMessageEvent([msg('a'), msg('b')], {
      type: 'message-delete',
      channelId: 'c1',
      messageId: 'a',
    });
    expect(next.map((m) => m.id)).toEqual(['b']);
  });

  it('caps the rolling window at MESSAGE_CAP, dropping the oldest', () => {
    const full = Array.from({ length: MESSAGE_CAP }, (_, i) => msg(`m${i}`));
    const next = applyMessageEvent(full, { type: 'message', action: 'create', message: msg('newest') });
    expect(next).toHaveLength(MESSAGE_CAP);
    expect(next[0].id).toBe('m1'); // m0 dropped
    expect(next.at(-1)?.id).toBe('newest');
  });
});

describe('applySpeaking', () => {
  const voice: DiscordSelectedVoiceData = {
    channelId: 'v1',
    channelName: 'Lounge',
    guildId: 'g1',
    members: [
      { userId: 'u1', name: 'Nish', avatarUrl: null, mute: false, deaf: false, speaking: false },
      { userId: 'u2', name: 'Friend', avatarUrl: null, mute: false, deaf: false, speaking: true },
    ],
  };

  it('flips exactly the target member', () => {
    const next = applySpeaking(voice, 'u1', true);
    expect(next?.members.map((m) => m.speaking)).toEqual([true, true]);
    // untouched input (immutability)
    expect(voice.members[0].speaking).toBe(false);
  });

  it('returns the same object for unknown users and null voice', () => {
    expect(applySpeaking(voice, 'nobody', true)).toBe(voice);
    expect(applySpeaking(null, 'u1', true)).toBeNull();
  });
});

describe('guildInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(guildInitials("Nish's Hangout")).toBe('NH');
    expect(guildInitials('solo')).toBe('S');
    expect(guildInitials('a b c')).toBe('AB');
    expect(guildInitials('  spaced   out ')).toBe('SO');
  });
});

describe('formatMessageTime', () => {
  it('shows a time for same-day stamps and a date otherwise', () => {
    const now = new Date('2026-07-14T18:00:00');
    expect(formatMessageTime('2026-07-14T12:34:00', now)).toMatch(/12:34|:34/);
    expect(formatMessageTime('2026-07-01T12:34:00', now)).toMatch(/Jul/);
    expect(formatMessageTime('garbage', now)).toBe('');
  });
});
