import { describe, expect, it } from 'vitest';
import type { InboxItemData } from '@dash/shared';
import { SNOOZE_OPTIONS, at8, groupBySeverity, safeHref } from './inboxSort';

function item(over: Partial<InboxItemData> & { id: number }): InboxItemData {
  return {
    source: 'ci', kind: 'k', title: `t${over.id}`, body: null, url: null, severity: 'normal', count: 1,
    createdAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T10:00:00Z', occurredAt: '2026-10-30T10:00:00Z',
    handledAt: null, handledBy: null, snoozedUntil: null, data: null, ...over,
  };
}
const none = () => false;

describe('groupBySeverity', () => {
  it('orders urgent, normal, info and drops empty groups', () => {
    const g = groupBySeverity([item({ id: 1, severity: 'info' }), item({ id: 2, severity: 'urgent' })], none);
    expect(g.map((x) => x.severity)).toEqual(['urgent', 'info']);
  });

  it('sorts newest first, ties by id desc', () => {
    const g = groupBySeverity(
      [
        item({ id: 1, updatedAt: '2026-10-30T09:00:00Z' }),
        item({ id: 2, updatedAt: '2026-10-30T11:00:00Z' }),
        item({ id: 3, updatedAt: '2026-10-30T11:00:00Z' }),
      ],
      none,
    );
    expect(g[0].items.map((i) => i.id)).toEqual([3, 2, 1]);
  });

  it('puts acked rows last within their group', () => {
    const g = groupBySeverity(
      [item({ id: 1, updatedAt: '2026-10-30T12:00:00Z' }), item({ id: 2, updatedAt: '2026-10-30T08:00:00Z' })],
      (i) => i.id === 1,
    );
    expect(g[0].items.map((i) => i.id)).toEqual([2, 1]);
  });

  it('treats unknown severity as normal', () => {
    const odd = item({ id: 1 }) as unknown as { severity: string };
    odd.severity = 'weird';
    const g = groupBySeverity([odd as unknown as InboxItemData], none);
    expect(g.map((x) => x.severity)).toEqual(['normal']);
  });
});

describe('at8 / snooze options', () => {
  it('at8 gives 08:00 local N days ahead', () => {
    const d = at8(new Date(2026, 9, 30, 15, 30), 1);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 31, 8, 0]);
  });

  const monday = SNOOZE_OPTIONS[3];
  it('Monday 8 AM from a Wednesday is the coming Monday', () => {
    const d = monday.until(new Date(2026, 9, 28, 12)); // Wed
    expect([d.getDay(), d.getDate(), d.getHours()]).toEqual([1, 2, 8]);
  });
  it('Monday 8 AM from a Monday is a week later', () => {
    const d = monday.until(new Date(2026, 9, 26, 6)); // Mon
    expect([d.getDay(), d.getMonth(), d.getDate()]).toEqual([1, 10, 2]);
  });
  it('Monday 8 AM from a Sunday is the next day', () => {
    const d = monday.until(new Date(2026, 9, 25, 20)); // Sun
    expect([d.getDay(), d.getDate()]).toEqual([1, 26]);
  });
  it('hour options add fixed offsets', () => {
    const now = new Date(2026, 9, 30, 10);
    expect(SNOOZE_OPTIONS[0].until(now).getTime() - now.getTime()).toBe(3_600_000);
    expect(SNOOZE_OPTIONS[1].until(now).getTime() - now.getTime()).toBe(4 * 3_600_000);
  });
});

describe('safeHref', () => {
  it('allows http and https', () => {
    expect(safeHref('https://a.com/x')).toBe('https://a.com/x');
    expect(safeHref('http://a.com/')).toBe('http://a.com/');
  });
  it('rejects javascript:, file:, junk and null', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('file:///etc/passwd')).toBeNull();
    expect(safeHref('nope')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
