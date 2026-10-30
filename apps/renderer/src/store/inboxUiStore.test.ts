import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItemData } from '@dash/shared';

async function load() {
  return import('./inboxUiStore');
}

function item(id: number, count = 1): InboxItemData {
  return {
    id, source: 'ci', kind: 'k', title: 't', body: null, url: null, severity: 'normal', count,
    createdAt: '', updatedAt: '', occurredAt: '', handledAt: null, handledBy: null, snoozedUntil: null, data: null,
  };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('inboxUiStore', () => {
  it('has sane defaults', async () => {
    const { useInboxUiStore } = await load();
    const s = useInboxUiStore.getState();
    expect([s.acked, s.view, s.source]).toEqual([{}, 'open', null]);
  });

  it('toggleAck acks then un-acks', async () => {
    const { useInboxUiStore, isAckedIn } = await load();
    const it1 = item(7, 2);
    useInboxUiStore.getState().toggleAck(it1);
    expect(useInboxUiStore.getState().acked).toEqual({ '7': 2 });
    expect(isAckedIn(useInboxUiStore.getState().acked, it1)).toBe(true);
    useInboxUiStore.getState().toggleAck(it1);
    expect(useInboxUiStore.getState().acked).toEqual({});
  });

  it('ack lapses when the count grows, and toggling then re-acks at the new count', async () => {
    const { useInboxUiStore, isAckedIn } = await load();
    useInboxUiStore.getState().toggleAck(item(7, 2));
    const acked = useInboxUiStore.getState().acked;
    expect(isAckedIn(acked, item(7, 2))).toBe(true);
    expect(isAckedIn(acked, item(7, 3))).toBe(false);
    useInboxUiStore.getState().toggleAck(item(7, 3));
    expect(useInboxUiStore.getState().acked).toEqual({ '7': 3 });
  });

  it('pruneAcked keeps only open ids and is a no-op when nothing changes', async () => {
    const { useInboxUiStore } = await load();
    useInboxUiStore.getState().toggleAck(item(1));
    useInboxUiStore.getState().toggleAck(item(2));
    const before = useInboxUiStore.getState().acked;
    useInboxUiStore.getState().pruneAcked([1, 2, 3]);
    expect(useInboxUiStore.getState().acked).toBe(before);
    useInboxUiStore.getState().pruneAcked([2]);
    expect(useInboxUiStore.getState().acked).toEqual({ '2': 1 });
  });

  it('setView resets the source filter', async () => {
    const { useInboxUiStore } = await load();
    useInboxUiStore.getState().setSource('ci');
    expect(useInboxUiStore.getState().source).toBe('ci');
    useInboxUiStore.getState().setView('snoozed');
    expect(useInboxUiStore.getState().view).toBe('snoozed');
    expect(useInboxUiStore.getState().source).toBeNull();
  });

  it('persists and rehydrates', async () => {
    const { useInboxUiStore } = await load();
    useInboxUiStore.getState().toggleAck(item(5, 4));
    useInboxUiStore.getState().setView('handled');
    const raw = JSON.parse(localStorage.getItem('dashboard-inbox-ui') as string);
    expect(raw.version).toBe(1);
    expect(raw.state).toEqual({ acked: { '5': 4 }, view: 'handled', source: null });

    vi.resetModules();
    localStorage.setItem(
      'dashboard-inbox-ui',
      JSON.stringify({ state: { acked: { '9': 2 }, view: 'snoozed', source: 'ci' }, version: 1 }),
    );
    const again = await load();
    const s = again.useInboxUiStore.getState();
    expect([s.acked, s.view, s.source]).toEqual([{ '9': 2 }, 'snoozed', 'ci']);
  });
});
