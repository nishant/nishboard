import { useQuery } from '@tanstack/react-query';
import type { ClaudeChatRequestBody, ClaudeStatusData, ClaudeStreamEvent } from '@dash/shared';
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

function lastAssistantText(): string {
  const { messages } = useClaudeStore.getState();
  const last = messages[messages.length - 1];
  return last && last.role === 'assistant' ? last.text : '';
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
    const body: ClaudeChatRequestBody = {
      message: trimmed,
      sessionId: store.sessionId ?? undefined,
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
          case 'message':
            // Authoritative final text — replaces the accumulated deltas.
            s.finalizeAssistant(event.text);
            break;
          case 'done':
            s.setStreaming(false);
            break;
          case 'error': {
            toast('Claude', event.message, 'error');
            const partial = lastAssistantText();
            s.finalizeAssistant(partial ? `${partial}\n\n⚠ ${event.message}` : `⚠ ${event.message}`);
            s.setStreaming(false);
            break;
          }
        }
      },
    }).catch((err: unknown) => {
      const s = useClaudeStore.getState();
      s.setStreaming(false);
      // Stop pressed → AbortError, keep whatever partial text streamed in.
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      toast('Claude', message, 'error');
      const partial = lastAssistantText();
      s.finalizeAssistant(partial ? `${partial}\n\n⚠ ${message}` : `⚠ ${message}`);
    });
  };

  return { send, stop: stopClaudeStream };
}
