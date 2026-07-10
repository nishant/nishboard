import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, SendHorizontal, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { messageText, useClaudeStore } from '../../store/claudeStore';
import type { ClaudeChatMessage, ClaudeToolPart } from '../../store/claudeStore';
import { useClaudeStatus, useSendClaudeMessage, stopClaudeStream } from './useClaude';
import { HeaderAction } from '../../components/HeaderAction';
import { cn } from '../../lib/utils';

/** WidgetShell header actions: New chat always; Stop only mid-stream. */
export function ClaudeActions() {
  const isStreaming = useClaudeStore((s) => s.isStreaming);
  const newChat = useClaudeStore((s) => s.newChat);
  return (
    <>
      {isStreaming && (
        <HeaderAction title="Stop response" danger onClick={stopClaudeStream}>
          <Square size={11} />
        </HeaderAction>
      )}
      <HeaderAction
        title="New chat"
        onClick={() => {
          // Kill any in-flight stream first so late deltas can't land in the
          // fresh (empty) conversation.
          stopClaudeStream();
          newChat();
        }}
      >
        <Plus size={12} />
      </HeaderAction>
    </>
  );
}

/** Inline chip for one tool call. `live` = this is the actively-streaming
 *  message, so a still-'running' tool shows a spinner; on a reloaded/old message
 *  a lingering 'running' renders as done rather than a perpetual spinner. */
function ToolChip({ part, live }: { part: ClaudeToolPart; live: boolean }) {
  const running = part.status === 'running' && live;
  return (
    <div className="flex items-center gap-1.5 my-1 px-2 py-1 rounded-md bg-th-elevated/60 text-[11px] max-w-full">
      {part.status === 'error' ? (
        <X size={11} className="shrink-0 text-red-400" />
      ) : running ? (
        <Loader2 size={11} className="shrink-0 animate-spin text-th-accent" />
      ) : (
        <Check size={11} className="shrink-0 text-emerald-400" />
      )}
      <span className="shrink-0 font-medium text-th-hi">{part.name}</span>
      {part.detail && (
        <>
          <span className="shrink-0 text-th-ghost">·</span>
          <span className="truncate font-mono text-th-ghost">{part.detail}</span>
        </>
      )}
    </div>
  );
}

function MessageBubble({ msg, streaming }: { msg: ClaudeChatMessage; streaming: boolean }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-th-elevated px-2.5 py-1.5 text-xs text-th-hi whitespace-pre-wrap break-words">
          {messageText(msg)}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-full text-xs text-th-2 leading-relaxed space-y-0.5">
      {msg.parts.map((part, i) =>
        part.kind === 'tool' ? (
          <ToolChip key={part.id} part={part} live={streaming} />
        ) : part.text ? (
          <div key={i} className="md-render break-words">
            <ReactMarkdown>{part.text}</ReactMarkdown>
          </div>
        ) : null,
      )}
      {streaming && (
        <span className="inline-block w-1.5 h-3.5 rounded-[1px] bg-th-accent/80 animate-pulse align-text-bottom" />
      )}
    </div>
  );
}

export function ClaudeWidget() {
  const status = useClaudeStatus();
  const messages = useClaudeStore((s) => s.messages);
  const isStreaming = useClaudeStore((s) => s.isStreaming);
  const model = useClaudeStore((s) => s.model);
  const { send, stop } = useSendClaudeMessage();

  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  // Stick to the bottom while streaming — but stop following the moment the
  // user scrolls up to re-read something.
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!pinned) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pinned]);

  const onScroll = (): void => {
    const el = listRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  const handleSend = (): void => {
    const text = draft.trim();
    if (!text || isStreaming) return;
    setDraft('');
    setPinned(true);
    send(text);
  };

  if (status.data?.available === false) {
    return (
      <div className="h-full flex items-center justify-center p-4 text-center">
        <p className="text-th-ghost text-xs leading-relaxed max-w-64">
          Claude Code not found — install it from claude.com/claude-code, then run{' '}
          <code className="bg-th-elevated px-1 py-0.5 rounded text-th-2">claude /login</code>.
        </p>
      </div>
    );
  }

  const lastId = messages[messages.length - 1]?.id;

  return (
    <div className="h-full flex flex-col">
      {/* Message list */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-2.5 pt-2 space-y-2.5"
      >
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-th-ghost text-xs">Ask Claude anything…</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              streaming={isStreaming && msg.id === lastId && msg.role === 'assistant'}
            />
          ))
        )}
      </div>

      {/* Input row */}
      <div className="shrink-0 px-2 pb-1.5 pt-1.5 flex items-end gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter = send · Shift+Enter = newline
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask Claude anything…"
          disabled={isStreaming}
          rows={2}
          spellCheck={false}
          className={cn(
            'flex-1 resize-none rounded-lg bg-th-elevated px-2.5 py-1.5 text-xs text-th-hi',
            'placeholder:text-th-ghost focus:outline-none focus:ring-1 focus:ring-th-accent/40',
            isStreaming && 'opacity-50 cursor-not-allowed',
          )}
        />
        {isStreaming ? (
          <button
            onClick={stop}
            title="Stop"
            aria-label="Stop"
            className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-th-elevated text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            title="Send"
            aria-label="Send"
            className={cn(
              'shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors',
              draft.trim()
                ? 'bg-th-accent/15 text-th-accent hover:bg-th-accent/25'
                : 'bg-th-elevated text-th-ghost cursor-default',
            )}
          >
            <SendHorizontal size={12} />
          </button>
        )}
      </div>

      {/* Footer model chip */}
      {model && (
        <div className="shrink-0 px-2.5 pb-1.5 flex items-center gap-1">
          <span className="px-1.5 py-px rounded-full bg-th-elevated text-th-ghost text-[9px]">{model}</span>
        </div>
      )}
    </div>
  );
}
