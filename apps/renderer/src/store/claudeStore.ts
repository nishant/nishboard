import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ClaudeChatMode, ClaudeEffort } from '@dash/shared';

/** A run of assistant text (streamed from `delta` frames). */
export interface ClaudeTextPart {
  kind: 'text';
  text: string;
}
/** Extended-thinking text — rendered as a collapsed grey block above the answer. */
export interface ClaudeThinkingPart {
  kind: 'thinking';
  text: string;
}
/** A tool the model invoked (Write, Bash, a Skill, …), shown as an inline chip. */
export interface ClaudeToolPart {
  kind: 'tool';
  /** CLI tool_use id — matches the `tool-result` that resolves it. */
  id: string;
  name: string;
  detail: string;
  status: 'running' | 'ok' | 'error';
}
export type ClaudePart = ClaudeTextPart | ClaudeThinkingPart | ClaudeToolPart;

/**
 * A message is an ORDERED list of parts so tool activity interleaves with text
 * exactly as it happened ("Let me write that." → [Write notes.md] → "Done!").
 * User messages are always a single text part.
 */
export interface ClaudeChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: ClaudePart[];
  at: number;
  /** Set on assistant messages when their turn's `done` frame arrives. */
  durationMs?: number;
  outputTokens?: number;
}

/** Concatenated text of a message (ignores tool parts). */
export function messageText(m: ClaudeChatMessage): string {
  return m.parts.reduce((acc, p) => (p.kind === 'text' ? acc + p.text : acc), '');
}

interface ClaudeState {
  messages: ClaudeChatMessage[];
  /** CLI session id — lets follow-up turns `--resume` the same conversation. */
  sessionId: string | null;
  model: string | null;
  isStreaming: boolean;
  /** Permission posture sent with each turn (chat / auto / plan). */
  chatMode: ClaudeChatMode;
  /** `--model` value for new turns; null = CLI default. */
  chatModel: string | null;
  /** `--effort` level for new turns; null = CLI default. */
  chatEffort: ClaudeEffort | null;
  addUser: (text: string) => void;
  /** Push an empty assistant message for the incoming stream to fill. */
  beginAssistant: () => void;
  /** Append streamed text to the current assistant message (merges into the
   *  trailing text part, or starts a new one after a tool call). */
  appendDelta: (text: string) => void;
  /** Append extended-thinking text (merges like appendDelta, own part kind). */
  appendThinking: (text: string) => void;
  /** Stamp duration/token stats onto the current assistant message and record
   *  the turn's context consumption for the usage popover. */
  finishAssistant: (durationMs: number, outputTokens: number | null, contextTokens: number | null) => void;
  /** Context tokens consumed by the most recent turn (null before any turn). */
  lastContextTokens: number | null;
  /** The model started a tool call — append a running chip. */
  addToolPart: (id: string, name: string, detail: string) => void;
  /** A tool call finished — flip its chip to ok/error. */
  resolveToolPart: (id: string, isError: boolean) => void;
  /** Append an error note to the current assistant message (client-side only). */
  appendError: (text: string) => void;
  setSession: (id: string, model: string) => void;
  setStreaming: (isStreaming: boolean) => void;
  setChatMode: (mode: ClaudeChatMode) => void;
  setChatModel: (model: string | null) => void;
  setChatEffort: (effort: ClaudeEffort | null) => void;
  newChat: () => void;
}

/** Mutate the trailing assistant message via `fn`, returning a new messages array
 *  (no-op if the last message isn't an assistant turn). */
function patchLastAssistant(
  messages: ClaudeChatMessage[],
  fn: (m: ClaudeChatMessage) => ClaudeChatMessage,
): ClaudeChatMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant') return messages;
  return [...messages.slice(0, -1), fn(last)];
}

export const useClaudeStore = create<ClaudeState>()(
  persist(
    (set) => ({
      messages: [],
      sessionId: null,
      model: null,
      isStreaming: false,
      chatMode: 'chat',
      chatModel: null,
      chatEffort: null,
      lastContextTokens: null,

      addUser: (text) =>
        set((s) => ({
          messages: [
            ...s.messages,
            { id: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text }], at: Date.now() },
          ],
        })),
      beginAssistant: () =>
        set((s) => ({
          messages: [...s.messages, { id: crypto.randomUUID(), role: 'assistant', parts: [], at: Date.now() }],
        })),
      appendDelta: (text) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => {
            const last = m.parts[m.parts.length - 1];
            if (last && last.kind === 'text') {
              return { ...m, parts: [...m.parts.slice(0, -1), { ...last, text: last.text + text }] };
            }
            return { ...m, parts: [...m.parts, { kind: 'text', text }] };
          }),
        })),
      appendThinking: (text) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => {
            const last = m.parts[m.parts.length - 1];
            if (last && last.kind === 'thinking') {
              return { ...m, parts: [...m.parts.slice(0, -1), { ...last, text: last.text + text }] };
            }
            return { ...m, parts: [...m.parts, { kind: 'thinking', text }] };
          }),
        })),
      finishAssistant: (durationMs, outputTokens, contextTokens) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => ({
            ...m,
            durationMs,
            ...(outputTokens !== null ? { outputTokens } : {}),
          })),
          ...(contextTokens !== null ? { lastContextTokens: contextTokens } : {}),
        })),
      addToolPart: (id, name, detail) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => ({
            ...m,
            parts: [...m.parts, { kind: 'tool', id, name, detail, status: 'running' }],
          })),
        })),
      resolveToolPart: (id, isError) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.kind === 'tool' && p.id === id ? { ...p, status: isError ? 'error' : 'ok' } : p,
            ),
          })),
        })),
      appendError: (text) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => ({
            ...m,
            parts: [...m.parts, { kind: 'text', text: `\n\n⚠ ${text}` }],
          })),
        })),
      setSession: (sessionId, model) => set({ sessionId, model }),
      setStreaming: (isStreaming) => set({ isStreaming }),
      setChatMode: (chatMode) => set({ chatMode }),
      setChatModel: (chatModel) => set({ chatModel }),
      setChatEffort: (chatEffort) => set({ chatEffort }),
      newChat: () => set({ messages: [], sessionId: null }),
    }),
    {
      name: 'dashboard-claude',
      version: 2,
      // NEVER persist isStreaming — a reload mid-stream would resurrect a
      // permanently-disabled input with no stream behind it.
      partialize: (s) => ({
        messages: s.messages,
        sessionId: s.sessionId,
        model: s.model,
        chatMode: s.chatMode,
        chatModel: s.chatModel,
        chatEffort: s.chatEffort,
        lastContextTokens: s.lastContextTokens,
      }),
      // v1 messages were flat `{ text: string }`; v2 is `{ parts: ClaudePart[] }`.
      migrate: (persisted, version) => {
        const state = persisted as { messages?: Array<Record<string, unknown>> } & Record<string, unknown>;
        if (version < 2 && Array.isArray(state.messages)) {
          state.messages = state.messages.map((m) => {
            if (Array.isArray((m as { parts?: unknown }).parts)) return m;
            const text = typeof m.text === 'string' ? m.text : '';
            return { id: m.id, role: m.role, at: m.at, parts: text ? [{ kind: 'text', text }] : [] };
          });
        }
        return state as unknown as ClaudeState;
      },
    },
  ),
);
