import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { CLAUDE_EFFORTS } from '@dash/shared';
import type { ClaudeChatMode, ClaudeEffort, ClaudePromptRequest } from '@dash/shared';

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
/** An interactive prompt from the CLI (permission / question / plan approval),
 *  rendered as an in-message card with buttons while `pending`. */
export interface ClaudePromptPart {
  kind: 'prompt';
  requestId: string;
  request: ClaudePromptRequest;
  status: 'pending' | 'allowed' | 'denied' | 'cancelled' | 'timeout';
  /** Human summary of what the user chose ("Blue", "Plan approved", …). */
  resolution?: string;
}

export type ClaudePart = ClaudeTextPart | ClaudeThinkingPart | ClaudeToolPart | ClaudePromptPart;

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
  /** Permission posture sent with each turn (ask / auto / plan). */
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
  /** The CLI raised a permission/question/plan prompt — append a pending card. */
  addPromptPart: (requestId: string, request: ClaudePromptRequest) => void;
  /** A prompt finished (user click / timeout / cancellation). */
  resolvePromptPart: (requestId: string, status: ClaudePromptPart['status'], resolution?: string) => void;
  /** Flip every still-pending prompt to cancelled (stream stopped/errored). */
  cancelPendingPrompts: () => void;
  /** Append an error note to the current assistant message (client-side only). */
  appendError: (text: string) => void;
  setSession: (id: string, model: string) => void;
  setStreaming: (isStreaming: boolean) => void;
  setChatMode: (mode: ClaudeChatMode) => void;
  setChatModel: (model: string | null) => void;
  setChatEffort: (effort: ClaudeEffort | null) => void;
  newChat: () => void;
  /** Remove the trailing user message and its still-empty assistant reply
   *  (a send that never reached the server). */
  dropUnsentTurn: () => void;
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


/** Persisted history cap and the tighter cap used after a quota error. */
export const PERSIST_MAX_MESSAGES = 50;
export const PERSIST_QUOTA_MAX_MESSAGES = 10;
export const PERSIST_MAX_TOOL_DETAIL = 2_000;

/** The slice of the transcript that is written to localStorage: the last `max`
 *  messages, without `thinking` parts, with long tool details cut. */
export function trimForPersist(messages: ClaudeChatMessage[], max = PERSIST_MAX_MESSAGES): ClaudeChatMessage[] {
  return messages.slice(-max).map((m) => ({
    ...m,
    parts: m.parts
      .filter((p) => p.kind !== 'thinking')
      .map((p) =>
        p.kind === 'tool' && p.detail.length > PERSIST_MAX_TOOL_DETAIL
          ? { ...p, detail: p.detail.slice(0, PERSIST_MAX_TOOL_DETAIL) }
          : p,
      ),
  }));
}

/** Mirrors the store's isStreaming so the storage wrapper can skip writes
 *  mid-turn without touching the (not yet initialised) store at module init. */
let streamingNow = false;

/** localStorage wrapper: no writes while a turn streams (the write triggered by
 *  setStreaming(false) at done/error/stop persists the finished turn), and on a
 *  quota error trim to the last 10 messages and retry once. */
export const claudeStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  removeItem: (name) => localStorage.removeItem(name),
  setItem: (name, value) => {
    if (streamingNow) return;
    try {
      localStorage.setItem(name, value);
    } catch {
      try {
        const parsed = JSON.parse(value) as { state?: { messages?: ClaudeChatMessage[] } };
        if (parsed.state && Array.isArray(parsed.state.messages)) {
          parsed.state.messages = trimForPersist(parsed.state.messages, PERSIST_QUOTA_MAX_MESSAGES);
        }
        localStorage.setItem(name, JSON.stringify(parsed));
      } catch {
        // still over quota: drop this write rather than break the stream
      }
    }
  },
};

/** The slice of state that is written to localStorage (see `partialize`). */
interface PersistedClaude {
  messages: ClaudeChatMessage[];
  sessionId: string | null;
  model: string | null;
  chatMode: ClaudeChatMode;
  chatModel: string | null;
  chatEffort: ClaudeEffort | null;
  lastContextTokens: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isEffort(v: unknown): v is ClaudeEffort {
  return CLAUDE_EFFORTS.some((e) => e === v);
}

/** Keep only well-formed parts; anything else from a corrupt store is dropped. */
function isPart(v: unknown): v is ClaudePart {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'text':
    case 'thinking':
      return typeof v.text === 'string';
    case 'tool':
      return typeof v.id === 'string' && typeof v.name === 'string' && typeof v.detail === 'string';
    case 'prompt':
      return typeof v.requestId === 'string' && isRecord(v.request) && typeof v.status === 'string';
    default:
      return false;
  }
}

/** Validate one persisted message (v1 flat `{ text }` messages become one text part). */
function toMessage(v: unknown): ClaudeChatMessage | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== 'string' || (v.role !== 'user' && v.role !== 'assistant')) return null;
  const at = typeof v.at === 'number' ? v.at : 0;
  let parts: ClaudePart[];
  if (Array.isArray(v.parts)) {
    parts = v.parts.filter(isPart);
  } else if (typeof v.text === 'string') {
    parts = v.text ? [{ kind: 'text', text: v.text }] : [];
  } else {
    return null;
  }
  const msg: ClaudeChatMessage = { id: v.id, role: v.role, parts, at };
  if (typeof v.durationMs === 'number') msg.durationMs = v.durationMs;
  if (typeof v.outputTokens === 'number') msg.outputTokens = v.outputTokens;
  return msg;
}

/** Type-guarded migration of whatever localStorage held, across every version:
 *  v1 messages were flat `{ text }`; v2 is `{ parts }`; v3 renamed mode 'chat'
 *  to 'ask'; v4 stopped persisting Auto. Invalid messages are dropped. */
export function migratePersisted(persisted: unknown): PersistedClaude {
  const raw = isRecord(persisted) ? persisted : {};
  const messages: ClaudeChatMessage[] = [];
  if (Array.isArray(raw.messages)) {
    for (const m of raw.messages) {
      const msg = toMessage(m);
      if (msg) messages.push(msg);
    }
  }
  // Legacy 'chat' (v<3) and Auto (v<4, never persisted since) both become 'ask'.
  return {
    messages,
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : null,
    model: typeof raw.model === 'string' ? raw.model : null,
    chatMode: raw.chatMode === 'plan' ? 'plan' : 'ask',
    chatModel: typeof raw.chatModel === 'string' ? raw.chatModel : null,
    chatEffort: isEffort(raw.chatEffort) ? raw.chatEffort : null,
    lastContextTokens: typeof raw.lastContextTokens === 'number' ? raw.lastContextTokens : null,
  };
}

export const useClaudeStore = create<ClaudeState>()(
  persist(
    (set) => ({
      messages: [],
      sessionId: null,
      model: null,
      isStreaming: false,
      chatMode: 'ask',
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
      addPromptPart: (requestId, request) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => ({
            ...m,
            parts: [...m.parts, { kind: 'prompt', requestId, request, status: 'pending' }],
          })),
        })),
      resolvePromptPart: (requestId, status, resolution) =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.kind === 'prompt' && p.requestId === requestId
                ? {
                    ...p,
                    // First resolution wins (the server frame and the POST's
                    // local stash race — arrival order varies)…
                    status: p.status === 'pending' ? status : p.status,
                    // …but a resolution summary attaches whenever it shows up.
                    ...(resolution !== undefined ? { resolution } : {}),
                  }
                : p,
            ),
          })),
        })),
      cancelPendingPrompts: () =>
        set((s) => ({
          messages: patchLastAssistant(s.messages, (m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.kind === 'prompt' && p.status === 'pending' ? { ...p, status: 'cancelled' } : p,
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
      setStreaming: (isStreaming) => {
        streamingNow = isStreaming;
        set({ isStreaming });
      },
      setChatMode: (chatMode) => set({ chatMode }),
      setChatModel: (chatModel) => set({ chatModel }),
      setChatEffort: (chatEffort) => set({ chatEffort }),
      newChat: () =>
        set({ messages: [], sessionId: null, model: null, lastContextTokens: null, chatMode: 'ask' }),
      dropUnsentTurn: () =>
        set((s) => {
          const msgs = [...s.messages];
          const last = msgs[msgs.length - 1];
          if (last && last.role === 'assistant' && last.parts.length === 0) msgs.pop();
          const prev = msgs[msgs.length - 1];
          if (prev && prev.role === 'user') msgs.pop();
          return { messages: msgs };
        }),
    }),
    {
      name: 'dashboard-claude',
      version: 5,
      storage: createJSONStorage(() => claudeStorage),
      // NEVER persist isStreaming — a reload mid-stream would resurrect a
      // permanently-disabled input with no stream behind it.
      partialize: (s): PersistedClaude => ({
        messages: trimForPersist(s.messages),
        sessionId: s.sessionId,
        model: s.model,
        // Auto (bypass permissions) never survives a restart.
        chatMode: s.chatMode === 'auto' ? 'ask' : s.chatMode,
        chatModel: s.chatModel,
        chatEffort: s.chatEffort,
        lastContextTokens: s.lastContextTokens,
      }),
      migrate: (persisted) => migratePersisted(persisted),
    },
  ),
);
