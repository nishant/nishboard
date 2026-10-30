import { describe, expect, it } from 'vitest';
import type { InboxFeedData, InboxItemData } from '@dash/shared';
import { mergeInboxPages, nextPageParam } from './useInbox';

function item(id: number, title = `t${id}`): InboxItemData {
  return {
    id, source: 'ci', kind: 'k', title, body: null, url: null, severity: 'normal', count: 1,
    createdAt: '2026-10-30T10:00:00Z', updatedAt: '2026-10-30T10:00:00Z', occurredAt: '2026-10-30T10:00:00Z',
    handledAt: null, handledBy: null, snoozedUntil: null, data: null,
  };
}
function page(items: InboxItemData[], nextCursor: string | null, open = 1): InboxFeedData {
  return {
    state: 'ok',
    list: { items, nextCursor, counts: { open, snoozed: 0, handled: 0, urgent: 0 }, sources: [{ id: 'ci', open }] },
  };
}

describe('nextPageParam', () => {
  it('returns undefined for a null cursor', () => {
    expect(nextPageParam(page([], null))).toBeUndefined();
  });
  it('passes a string cursor through', () => {
    expect(nextPageParam(page([], 'abc'))).toBe('abc');
  });
  it('returns undefined for non-ok pages', () => {
    expect(nextPageParam({ state: 'offline' })).toBeUndefined();
  });
});

describe('mergeInboxPages', () => {
  it('handles no pages', () => {
    expect(mergeInboxPages(undefined)).toEqual({ state: undefined, items: [], first: null });
    expect(mergeInboxPages([])).toEqual({ state: undefined, items: [], first: null });
  });
  it('keeps the first copy of a duplicate id and takes counts from the first page', () => {
    const m = mergeInboxPages([page([item(1, 'first'), item(2)], 'c', 5), page([item(2, 'dup'), item(3)], null, 9)]);
    expect(m.items.map((i) => `${i.id}:${i.title}`)).toEqual(['1:first', '2:t2', '3:t3']);
    expect(m.first?.counts.open).toBe(5);
    expect(m.state).toBe('ok');
  });
  it('skips non-ok later pages', () => {
    const m = mergeInboxPages([page([item(1)], 'c'), { state: 'offline' }]);
    expect(m.items.map((i) => i.id)).toEqual([1]);
  });
  it('gives an empty list and the state for a non-ok first page', () => {
    const m = mergeInboxPages([{ state: 'bad-password' }]);
    expect(m).toEqual({ state: 'bad-password', items: [], first: null });
  });
});
