import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ClaudeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

interface ClaudeState {
  messages: ClaudeChatMessage[];
  /** CLI session id — lets follow-up turns `--resume` the same conversation. */
  sessionId: string | null;
  model: string | null;
  isStreaming: boolean;
  addUser: (text: string) => void;
  /** Push an empty assistant message for the incoming stream to fill. */
  beginAssistant: () => void;
  appendDelta: (text: string) => void;
  /** Replace the streamed text with the authoritative final text when given. */
  finalizeAssistant: (text?: string) => void;
  setSession: (id: string, model: string) => void;
  setStreaming: (isStreaming: boolean) => void;
  newChat: () => void;
}

export const useClaudeStore = create<ClaudeState>()(
  persist(
    (set) => ({
      messages: [],
      sessionId: null,
      model: null,
      isStreaming: false,

      addUser: (text) =>
        set((s) => ({
          messages: [...s.messages, { id: crypto.randomUUID(), role: 'user', text, at: Date.now() }],
        })),
      beginAssistant: () =>
        set((s) => ({
          messages: [...s.messages, { id: crypto.randomUUID(), role: 'assistant', text: '', at: Date.now() }],
        })),
      appendDelta: (text) =>
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.role !== 'assistant') return s;
          return { messages: [...s.messages.slice(0, -1), { ...last, text: last.text + text }] };
        }),
      finalizeAssistant: (text) =>
        set((s) => {
          const last = s.messages[s.messages.length - 1];
          if (!last || last.role !== 'assistant') return s;
          if (text === undefined) return s;
          return { messages: [...s.messages.slice(0, -1), { ...last, text }] };
        }),
      setSession: (sessionId, model) => set({ sessionId, model }),
      setStreaming: (isStreaming) => set({ isStreaming }),
      newChat: () => set({ messages: [], sessionId: null }),
    }),
    {
      name: 'dashboard-claude',
      version: 1,
      // NEVER persist isStreaming — a reload mid-stream would resurrect a
      // permanently-disabled input with no stream behind it.
      partialize: (s) => ({ messages: s.messages, sessionId: s.sessionId, model: s.model }),
    },
  ),
);
