import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClaudeChatRequestBody,
  ClaudeControlRequestBody,
  ClaudeMetaData,
  ClaudePromptRequest,
  ClaudeStatusData,
  ClaudeStreamEvent,
  ClaudeUsageData,
} from '@dash/shared';
import { apiClient } from '../../lib/apiClient';
import { postEventStream } from '../../lib/streamClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import { useClaudeStore } from '../../store/claudeStore';
import { useAppSettingsStore } from '../../store/settingsStore';
import { fireAlert, toast } from '../../lib/alerts';

/** CLI availability probe — cheap on the server (60s TtlCache) so a slow poll
 *  is plenty; it flips the widget out of its "not installed" state. */
export function useClaudeStatus() {
  const interval = useGatedInterval(60_000);
  const queryClient = useQueryClient();
  useEffect(() => {
    // One-click CLI login: the main process pushes claude:login-finished once
    // its watcher sees fresh credentials — refetch now instead of waiting out
    // the 60s poll. Subscribed here so it works wherever the widget lives
    // (main window or popout).
    return window.electron?.claude.onLoginFinished(() => {
      void queryClient.invalidateQueries({ queryKey: ['claude-status'] });
      void queryClient.invalidateQueries({ queryKey: ['claude-usage'] });
    });
  }, [queryClient]);
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
  const s = useClaudeStore.getState();
  // Aborting closes the socket → the server reaps the child → any prompts the
  // CLI was waiting on are dead. Reflect that instead of leaving live buttons.
  s.cancelPendingPrompts();
  s.setStreaming(false);
}

/** One-line human summary for the prompt notification + resolved chips. */
export function promptSummary(request: ClaudePromptRequest): string {
  switch (request.kind) {
    case 'tool':
      return request.detail ? `${request.toolName} · ${request.detail}` : request.toolName;
    case 'question':
      return request.questions[0]?.question ?? 'Claude has a question';
    case 'plan':
      return 'Review Claude’s plan';
  }
}

/** Answer a pending prompt card. State flips when the server's
 *  `permission-resolved` frame arrives; on HTTP failure the card is flipped to
 *  cancelled locally so it never wedges in `pending`. */
export async function respondToClaudePrompt(
  requestId: string,
  response: ClaudeControlRequestBody['response'],
  resolution?: string,
): Promise<void> {
  const body: ClaudeControlRequestBody = { requestId, response };
  try {
    await apiClient.post('/api/claude/control', body);
    if (resolution !== undefined) {
      // The resolved frame carries no answer text — stash the human summary now.
      useClaudeStore.getState().resolvePromptPart(
        requestId,
        response.behavior === 'allow' ? 'allowed' : 'denied',
        resolution,
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast('Claude', message, 'error');
    useClaudeStore.getState().resolvePromptPart(requestId, 'cancelled');
  }
}

/** One-click CLI login (Settings → App → Claude + the widget's unavailable
 *  panel): main IPC opens a terminal running `claude auth login --claudeai`;
 *  the user finishes in the browser, then the main process auto-closes the
 *  terminal and pushes claude:login-finished (see useClaudeStatus). No-op
 *  outside Electron. */
export async function openClaudeCliLogin(): Promise<void> {
  if (!window.electron) return;
  try {
    const result = await window.electron.claude.openLogin();
    if (result === 'already-open') {
      toast('Claude', 'A login terminal is already open — finish logging in there.');
    } else {
      toast('Claude', 'Terminal opened — finish login in the browser. The window closes itself when done.');
    }
  } catch (err: unknown) {
    toast('Claude', err instanceof Error ? err.message : String(err), 'error');
  }
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
    // Mode/model/effort + workspace read at send time so composer/Settings
    // changes apply to the very next message.
    const settings = useAppSettingsStore.getState();
    const body: ClaudeChatRequestBody = {
      message: trimmed,
      sessionId: store.sessionId ?? undefined,
      mode: store.chatMode,
      model: store.chatModel ?? undefined,
      effort: store.chatEffort ?? undefined,
      workspaceDir: settings.claudeWorkspaceDir.trim() || undefined,
      additionalDirs: settings.claudeAdditionalDirs.length > 0 ? settings.claudeAdditionalDirs : undefined,
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
          case 'permission-request':
            s.addPromptPart(event.requestId, event.request);
            // Chime + toast + native notification — the whole point is pulling
            // the user back when Claude blocks on them mid-turn.
            fireAlert('Claude needs your input', promptSummary(event.request));
            break;
          case 'permission-resolved':
            s.resolvePromptPart(
              event.requestId,
              event.reason === 'user' ? (event.behavior === 'allow' ? 'allowed' : 'denied') : event.reason,
            );
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
