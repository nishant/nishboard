import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: ToastItem[];
  push: (t: { title: string; body?: string; kind?: ToastKind; ttlMs?: number }) => string;
  dismiss: (id: string) => void;
}

/** In-app transient notifications (non-persisted). Prefer `toast()` from
 *  lib/alerts.ts at call sites — this store is the implementation. */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: ({ title, body, kind = 'info', ttlMs = 4000 }) => {
    const id = crypto.randomUUID();
    // Keep at most 4 on screen — old ones fall off the front.
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, title, body, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, ttlMs);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
