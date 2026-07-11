import { useQuery } from '@tanstack/react-query';
import type {
  ClaudeChatRequestBody,
  ClaudeMetaData,
  ClaudeStatusData,
  ClaudeStreamEvent,
  ClaudeUsageData,
} from '@dash/shared';
import { apiClient } from '../../lib/apiClient';
import { postEventStream } from '../../lib/streamClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import { useClaudeStore } from '../../store/claudeStore';
import { toast } from '../../lib/alerts';

/** CLI availability probe — cheap on the server (60s TtlCache) so a slow poll
 *  is plenty; it flips the widget out of its "not installed" state. */
export function useClaudeStatus() {
  const interval = useGatedInterval(60_000);
  return useQuery<ClaudeStatusData>({
    queryKey: ['claude-status'],
    queryFn: () => apiClient.get<ClaudeStatusData>('/api/claude/status'),
    refetchInterval: interval,
    staleTime: 55_000,
  });
}

/** Slash-command autocomplete data. Refetched when the composer's slash menu
 *  opens (see refetch in the widget) — cheap: the server answers from memory. */
export function useClaudeMeta() {
  return useQuery<ClaudeMetaData>({
    queryKey: ['claude-meta'],
    queryFn: () => apiClient.get<ClaudeMetaData>('/api/claude/meta'),
    staleTime: 5 * 60_000,
  });
}

/** Subscription usage (5h session + weekly). Only fetched while the usage
 *  popover is open — `enabled` gates it. Server caches for 60s. */
export function useClaudeUsage(enabled: boolean) {
  return useQuery<ClaudeUsageData>({
    queryKey: ['claude-usage'],
    queryFn: () => apiClient.get<ClaudeUsageData>('/api/claude/usage'),
    enabled,
    staleTime: 60_000,
    retry: false, // errors carry actionable messages (login hints) — show them
  });
}

// Module-level (not a hook ref): the Stop button lives in ClaudeActions —
// a separate component tree in the WidgetShell header — so the controller
// must be reachable from both mount points. Single-flight is enforced
// server-side (409), so one controller slot is enough.
let activeController: AbortController | null = null;

/** Abort the in-flight stream (Stop button, New chat). Safe when idle. */
export function stopClaudeStream(): void {
  activeController?.abort();
  activeController = null;
  useClaudeStore.getState().setStreaming(false);
}

export function useSendClaudeMessage(): { send: (text: string) => void; stop: () => void } {
  const send = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const store = useClaudeStore.getState();
    if (store.isStreaming) return;

    store.addUser(trimmed);
    store.beginAssistant();
    store.setStreaming(true);

    const controller = new AbortController();
    activeController = controller;
    // Mode/model/effort read at send time so composer changes apply to the
    // very next message, including one queued mid-adjustment.
    const body: ClaudeChatRequestBody = {
      message: trimmed,
      sessionId: store.sessionId ?? undefined,
      mode: store.chatMode,
      model: store.chatModel ?? undefined,
      effort: store.chatEffort ?? undefined,
    };

    void postEventStream<ClaudeStreamEvent>('/api/claude/chat', body, {
      signal: controller.signal,
      onEvent: (event) => {
        const s = useClaudeStore.getState();
        switch (event.type) {
          case 'init':
            s.setSession(event.sessionId, event.model);
            break;
          case 'delta':
            s.appendDelta(event.text);
            break;
          case 'thinking':
            s.appendThinking(event.text);
            break;
          case 'tool-use':
            s.addToolPart(event.id, event.name, event.detail);
            break;
          case 'tool-result':
            s.resolveToolPart(event.id, event.isError);
            break;
          case 'done':
            s.finishAssistant(event.durationMs, event.outputTokens, event.contextTokens);
            s.setStreaming(false);
            break;
          case 'error':
            toast('Claude', event.message, 'error');
            s.appendError(event.message);
            s.setStreaming(false);
            break;
        }
      },
    }).catch((err: unknown) => {
      const s = useClaudeStore.getState();
      s.setStreaming(false);
      // Stop pressed → AbortError, keep whatever partial text streamed in.
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      toast('Claude', message, 'error');
      s.appendError(message);
    });
  };

  return { send, stop: stopClaudeStream };
}
