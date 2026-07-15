import type { DiscordMessageData, DiscordSelectedVoiceData, DiscordStreamEvent } from '@dash/shared';

// Pure state-transition helpers for the native Discord mode — kept out of the
// hooks file so tests import them without dragging react-query/jsdom wiring.

/** Cap the live feed — the widget shows a rolling window, not history. */
export const MESSAGE_CAP = 100;

/** Fold one message stream frame into the feed (append/replace/remove).
 *  Creates dedupe by id (an optimistic replay or a reconnect can repeat one);
 *  updates for messages outside the loaded window are dropped. */
export function applyMessageEvent(
  messages: DiscordMessageData[],
  event: Extract<DiscordStreamEvent, { type: 'message' } | { type: 'message-delete' }>,
): DiscordMessageData[] {
  if (event.type === 'message-delete') {
    return messages.filter((m) => m.id !== event.messageId);
  }
  const idx = messages.findIndex((m) => m.id === event.message.id);
  if (idx !== -1) {
    const next = [...messages];
    next[idx] = event.message;
    return next;
  }
  if (event.action === 'update') return messages; // update for an unloaded message
  return [...messages, event.message].slice(-MESSAGE_CAP);
}

/** Flip one member's speaking ring. */
export function applySpeaking(
  voice: DiscordSelectedVoiceData | null,
  userId: string,
  speaking: boolean,
): DiscordSelectedVoiceData | null {
  if (!voice) return voice;
  if (!voice.members.some((m) => m.userId === userId)) return voice;
  return {
    ...voice,
    members: voice.members.map((m) => (m.userId === userId ? { ...m, speaking } : m)),
  };
}

/** Initials for a guild without an icon — first letter of the first two words
 *  ("Nish's Hangout" → "NH"). */
export function guildInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Compact message timestamp: time for today, date otherwise. */
export function formatMessageTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
