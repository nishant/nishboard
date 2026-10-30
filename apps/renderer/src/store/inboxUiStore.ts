import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { InboxItemData, InboxViewData } from '@dash/shared';

// Persisted Inbox widget UI state. "Ack" is local to Nishboard (the inbox
// service has no ack concept): { [itemId]: countAtAck }. An ack lapses when
// the item's count grows past the acked count (it happened again).

interface InboxUiState {
  /** itemId -> count at ack */
  acked: Record<string, number>;
  view: InboxViewData;
  /** null = All sources */
  source: string | null;
  toggleAck: (item: InboxItemData) => void;
  pruneAcked: (openIds: number[]) => void;
  setView: (v: InboxViewData) => void;
  setSource: (s: string | null) => void;
}

/** True when acked and the item has not repeated since. */
export function isAckedIn(acked: Record<string, number>, item: InboxItemData): boolean {
  const at = acked[String(item.id)];
  return at !== undefined && item.count <= at;
}

export const useInboxUiStore = create<InboxUiState>()(
  persist(
    (set) => ({
      acked: {},
      view: 'open',
      source: null,
      toggleAck: (item) =>
        set((s) => {
          const key = String(item.id);
          if (isAckedIn(s.acked, item)) {
            const { [key]: _removed, ...rest } = s.acked;
            return { acked: rest };
          }
          return { acked: { ...s.acked, [key]: item.count } };
        }),
      pruneAcked: (openIds) =>
        set((s) => {
          const keep = new Set(openIds.map(String));
          const keys = Object.keys(s.acked);
          if (keys.every((k) => keep.has(k))) return s;
          const next: Record<string, number> = {};
          for (const k of keys) if (keep.has(k)) next[k] = s.acked[k];
          return { acked: next };
        }),
      setView: (view) => set({ view, source: null }),
      setSource: (source) => set({ source }),
    }),
    {
      name: 'dashboard-inbox-ui',
      version: 1,
      partialize: (s) => ({ acked: s.acked, view: s.view, source: s.source }),
    },
  ),
);
