import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronRight, ClipboardCheck, Copy, Loader2, PieChart, Plus, SendHorizontal,
  ShieldQuestion, SlidersHorizontal, Square, Terminal, X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ClaudeEffort } from '@dash/shared';
import { CLAUDE_CONTEXT_WINDOW, CLAUDE_EFFORTS } from '@dash/shared';
import { messageText, useClaudeStore } from '../../store/claudeStore';
import type { ClaudeChatMessage, ClaudePromptPart, ClaudeToolPart } from '../../store/claudeStore';
import {
  useClaudeStatus, useClaudeMeta, useClaudeUsage, useSendClaudeMessage, stopClaudeStream,
  respondToClaudePrompt, promptSummary, openClaudeCliLogin,
} from './useClaude';
import { HeaderAction } from '../../components/HeaderAction';
import { Badge, Button, EmptyState, ErrorState, IconButton, Meter, Segmented, SkeletonLines, Textarea, cn, toneFor, Label } from '@nish/ui';

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

// ── Loading shimmer ───────────────────────────────────────────────────────────

/** Claude-app-style status verbs, rotated while a response streams. */
const WHIMSY = [
  'Thinking', 'Pondering', 'Percolating', 'Pontificating', 'Noodling', 'Marinating',
  'Brewing', 'Cogitating', 'Conjuring', 'Contemplating', 'Deliberating', 'Hatching',
  'Ideating', 'Incubating', 'Mulling', 'Musing', 'Ruminating', 'Scheming',
  'Simmering', 'Synthesizing', 'Tinkering', 'Vibing', 'Whirring', 'Reticulating',
] as const;

/** Animated ✻ + rotating whimsical verb + elapsed seconds — shown for the whole
 *  streaming turn (covers the silent stretch before the first token). While a
 *  prompt card is pending, the whimsy gives way to "Waiting for you". */
function Shimmer({ startedAt, waiting = false }: { startedAt: number; waiting?: boolean }) {
  const [word, setWord] = useState(() => WHIMSY[Math.floor(Math.random() * WHIMSY.length)]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const wordTimer = setInterval(
      () => setWord(WHIMSY[Math.floor(Math.random() * WHIMSY.length)]),
      3_000,
    );
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      clearInterval(wordTimer);
      clearInterval(clock);
    };
  }, []);
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <div className="flex items-center gap-1.5 py-0.5 text-2xs select-none">
      <span className="claude-spark text-th-accent">✻</span>
      <span className="claude-shimmer font-medium">{waiting ? 'Waiting for you' : `${word}…`}</span>
      <span className="text-th-hi3 text-3xs">
        {waiting ? 'answer above to continue' : `${secs}s · esc to stop`}
      </span>
    </div>
  );
}

// ── Markdown pipeline ─────────────────────────────────────────────────────────

/** Links open in the system browser (Electron) — never navigate the app. */
function MdLink({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (!href) return;
        if (window.electron?.openExternal) window.electron.openExternal(href);
        else window.open(href, '_blank', 'noopener');
      }}
    >
      {children}
    </a>
  );
}

// Module-level so ReactMarkdown's props stay referentially stable across renders.
const MD_PLUGINS = [remarkGfm];
const MD_COMPONENTS = { a: MdLink };

// ── Small popover scaffold ────────────────────────────────────────────────────

/** Panel anchored above `anchor`, rendered through a PORTAL with fixed
 *  positioning — the WidgetShell's overflow-hidden would otherwise clip it in
 *  narrow grid tiles (the usage bars looked mis-filled because their left side
 *  was cut off at the tile edge, while the right-aligned % labels survived).
 *  The fixed backdrop closes on any outside click. */
function Popover({ anchor, onClose, children, wide = false }: {
  anchor: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const width = wide ? 256 : 208; // Tailwind w-64 / w-52 in px
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    // Right-align to the trigger, clamped inside the viewport.
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ left, bottom: window.innerHeight - r.top + 6 });
  }, [anchor, width]);
  if (!pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 rounded-lg border border-th-line bg-th-elevated shadow-pop p-2.5"
        style={{ left: pos.left, bottom: pos.bottom, width }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

// ── Model + effort ────────────────────────────────────────────────────────────

const MODEL_OPTIONS: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'Default' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'fable', label: 'Fable' },
];

function modelLabel(value: string | null): string {
  return MODEL_OPTIONS.find((o) => o.value === value)?.label ?? value ?? 'Default';
}

function ModelEffortPanel({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const chatModel = useClaudeStore((s) => s.chatModel);
  const chatEffort = useClaudeStore((s) => s.chatEffort);
  const sessionModel = useClaudeStore((s) => s.model);
  const setChatModel = useClaudeStore((s) => s.setChatModel);
  const setChatEffort = useClaudeStore((s) => s.setChatEffort);
  const effortIdx = chatEffort ? CLAUDE_EFFORTS.indexOf(chatEffort) : 2;

  return (
    <Popover anchor={anchor} onClose={onClose}>
      <Label className="block text-3xs font-semibold mb-1.5">Model</Label>
      <div className="flex flex-col gap-0.5">
        {MODEL_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            onClick={() => setChatModel(opt.value)}
            className={cn(
              'flex items-center justify-between px-2 py-1 rounded text-2xs transition-colors',
              opt.value === chatModel
                ? 'bg-th-overlay text-th-hi'
                : 'text-th-hi2 hover:bg-th-overlay',
            )}
          >
            {opt.label}
            {opt.value === chatModel && <Check size={11} className="text-th-accent" />}
          </button>
        ))}
      </div>

      <Label className="block text-3xs font-semibold mt-2.5 mb-1">
        Effort{' '}
        <span className={cn('normal-case tracking-normal', chatEffort ? 'text-th-accent' : 'text-th-hi3')}>
          — {chatEffort ?? 'default'}
        </span>
      </Label>
      <input
        type="range"
        min={0}
        max={CLAUDE_EFFORTS.length - 1}
        step={1}
        value={effortIdx}
        onChange={(e) => setChatEffort(CLAUDE_EFFORTS[Number(e.target.value)] as ClaudeEffort)}
        className={cn('w-full accent-th-accent', !chatEffort && 'opacity-50')}
        aria-label="Effort level"
      />
      <div className="flex justify-between text-3xs text-th-hi3 px-0.5">
        <span>low</span><span>med</span><span>high</span><span>xhigh</span><span>max</span>
      </div>
      {chatEffort && (
        <Button variant="link" size="xs" onClick={() => setChatEffort(null)} className="mt-1.5">
          Reset to CLI default
        </Button>
      )}
      {sessionModel && (
        <p className="mt-2 pt-1.5 border-t border-th-line text-3xs text-th-hi3 truncate">
          Session model: {sessionModel}
        </p>
      )}
    </Popover>
  );
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function formatResetsIn(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `resets in ${hours}h ${mins % 60}m`;
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Usage meters: info below 70%, then warn, then loss from 90%. */
function usageTone(pct: number): 'info' | 'warn' | 'loss' {
  const t = toneFor(pct, { warn: 70, loss: 90 });
  return t === 'ok' ? 'info' : t;
}

function UsagePanel({ anchor, onClose }: { anchor: HTMLElement | null; onClose: () => void }) {
  const usage = useClaudeUsage(true);
  const lastContext = useClaudeStore((s) => s.lastContextTokens);
  const contextPct = lastContext !== null ? Math.min(100, (lastContext / CLAUDE_CONTEXT_WINDOW) * 100) : null;
  return (
    <Popover anchor={anchor} onClose={onClose} wide>
      {lastContext !== null && contextPct !== null && (
        <div className="mb-2.5">
          <div className="flex items-baseline justify-between mb-0.5">
            <span className="text-3xs text-th-hi2">Context — this chat</span>
            <span className="text-3xs font-medium text-th-hi">
              {formatTokens(lastContext)} / {formatTokens(CLAUDE_CONTEXT_WINDOW)}
            </span>
          </div>
          <Meter value={contextPct} label="Context used" tone={usageTone(contextPct)} track="overlay" />
        </div>
      )}
      <Label className="block text-3xs font-semibold mb-2">Usage</Label>
      {usage.isLoading ? (
        <SkeletonLines lines={2} className="p-0" />
      ) : usage.isError ? (
        <ErrorState
          compact
          message={usage.error instanceof Error ? usage.error.message : 'Failed to load usage'}
          onRetry={() => void usage.refetch()}
          retrying={usage.isFetching}
        />
      ) : usage.data && usage.data.windows.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {usage.data.windows.map((w) => {
            const resets = formatResetsIn(w.resetsAt);
            return (
              <div key={w.key}>
                <div className="flex items-baseline justify-between mb-0.5">
                  <span className="text-3xs text-th-hi2">{w.label}</span>
                  <span className="text-3xs font-medium text-th-hi">{Math.round(w.utilization)}%</span>
                </div>
                <Meter value={w.utilization} label={`${w.label} used`} tone={usageTone(w.utilization)} track="overlay" />
                {resets && <p className="mt-0.5 text-3xs text-th-hi3">{resets}</p>}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-3xs text-th-hi3">No usage windows reported.</p>
      )}
    </Popover>
  );
}

// ── Slash-command autocomplete ────────────────────────────────────────────────

function SlashMenu({ query, selected, onPick }: {
  query: string;
  selected: number;
  onPick: (name: string) => void;
}) {
  const meta = useClaudeMeta();
  const items = useMemo(() => {
    const all = meta.data?.slashCommands ?? [];
    const q = query.toLowerCase();
    const starts = all.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 12);
  }, [meta.data, query]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1.5 z-50 rounded-lg border border-th-line bg-th-elevated shadow-pop py-1 max-h-44 overflow-y-auto">
      {items.length === 0 ? (
        <p className="px-2.5 py-1.5 text-3xs text-th-hi3">
          {meta.data && meta.data.slashCommands.length === 0
            ? 'Commands appear after your first chat.'
            : 'No matching commands.'}
        </p>
      ) : (
        items.map((c, i) => (
          <button
            key={c.name}
            data-slash-idx={i}
            onClick={() => onPick(c.name)}
            onMouseDown={(e) => e.preventDefault()} // keep textarea focus
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1 text-left text-2xs transition-colors',
              i === selected % Math.max(1, items.length)
                ? 'bg-th-overlay text-th-hi'
                : 'text-th-hi2 hover:bg-th-overlay',
            )}
          >
            <span className="font-mono">/{c.name}</span>
            {c.isSkill && (
              <Badge tone="accent" size="xs" variant="tag" className="ml-auto">skill</Badge>
            )}
          </button>
        ))
      )}
    </div>
  );
}

/** Items currently visible in the slash menu — duplicated tiny filter so the
 *  keyboard handler (in the widget) and the menu agree on ordering. */
function filterSlashItems(all: Array<{ name: string; isSkill: boolean }>, query: string) {
  const q = query.toLowerCase();
  const starts = all.filter((c) => c.name.toLowerCase().startsWith(q));
  const contains = all.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
  return [...starts, ...contains].slice(0, 12);
}

// ── Message rendering ─────────────────────────────────────────────────────────

/** Inline chip for one tool call. `live` = this is the actively-streaming
 *  message, so a still-'running' tool shows a spinner; on a reloaded/old message
 *  a lingering 'running' renders as done rather than a perpetual spinner. */
function ToolChip({ part, live }: { part: ClaudeToolPart; live: boolean }) {
  const running = part.status === 'running' && live;
  return (
    <div className="flex items-center gap-1.5 my-1 px-2 py-1 rounded-md bg-th-elevated text-2xs max-w-full">
      {part.status === 'error' ? (
        <X size={11} className="shrink-0 text-th-loss" />
      ) : running ? (
        <Loader2 size={11} className="shrink-0 animate-spin text-th-accent" />
      ) : (
        <Check size={11} className="shrink-0 text-th-ok" />
      )}
      <span className="shrink-0 font-medium text-th-hi">{part.name}</span>
      {part.detail && (
        <>
          <span className="shrink-0 text-th-hi3">·</span>
          <span className="truncate font-mono text-th-hi3">{part.detail}</span>
        </>
      )}
    </div>
  );
}

// ── Interactive prompt cards ──────────────────────────────────────────────────

function CardButton({ primary = false, disabled, onClick, children }: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button size="xs" variant={primary ? 'soft' : 'subtle'} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

const PROMPT_STATUS_LABEL: Record<Exclude<ClaudePromptPart['status'], 'pending'>, string> = {
  allowed: 'Allowed',
  denied: 'Denied',
  cancelled: 'Cancelled',
  timeout: 'Timed out',
};

/** In-message card for a CLI prompt (tool permission / question / plan).
 *  `live` = the actively-streaming message; a pending prompt on an old message
 *  (app reloaded mid-turn) renders as Expired instead of live buttons. */
function PromptCard({ part, live }: { part: ClaudePromptPart; live: boolean }) {
  const [busy, setBusy] = useState(false);
  // Per-question selected labels (multi-select accumulates; single replaces).
  const [selected, setSelected] = useState<string[][]>(() =>
    part.request.kind === 'question' ? part.request.questions.map(() => []) : [],
  );

  if (part.status !== 'pending' || !live) {
    const status = part.status === 'pending' ? 'Expired' : PROMPT_STATUS_LABEL[part.status];
    const ok = part.status === 'allowed';
    return (
      <div className="flex items-center gap-1.5 my-1 px-2 py-1 rounded-md bg-th-elevated text-2xs max-w-full">
        {ok ? <Check size={11} className="shrink-0 text-th-ok" /> : <X size={11} className="shrink-0 text-th-hi3" />}
        <span className="shrink-0 font-medium text-th-hi">{status}</span>
        <span className="shrink-0 text-th-hi3">·</span>
        <span className="truncate text-th-hi3">
          {promptSummary(part.request)}
          {part.resolution ? ` — ${part.resolution}` : ''}
        </span>
      </div>
    );
  }

  const respond = (response: Parameters<typeof respondToClaudePrompt>[1], resolution?: string): void => {
    setBusy(true);
    void respondToClaudePrompt(part.requestId, response, resolution);
  };

  if (part.request.kind === 'question') {
    const { questions } = part.request;
    const allAnswered = selected.every((s) => s.length > 0);
    const submit = (finalSelected: string[][]): void => {
      respond({ behavior: 'allow', answers: finalSelected }, finalSelected.map((s) => s.join(', ')).join(' · '));
    };
    return (
      <div className="my-1.5 rounded-lg border border-th-accent/30 bg-th-accent-soft p-2 space-y-2">
        {questions.map((q, qi) => (
          <div key={qi}>
            <p className="text-2xs text-th-hi font-medium mb-1">
              {q.header && <Badge tone="accent" size="xs" variant="tag" className="mr-1.5">{q.header}</Badge>}
              {q.question}
            </p>
            <div className="flex flex-col gap-1">
              {q.options.map((opt) => {
                const isOn = selected[qi]?.includes(opt.label);
                return (
                  <button
                    key={opt.label}
                    disabled={busy}
                    onClick={() => {
                      const next = selected.map((s, i) => {
                        if (i !== qi) return s;
                        if (q.multiSelect) return isOn ? s.filter((l) => l !== opt.label) : [...s, opt.label];
                        return [opt.label];
                      });
                      setSelected(next);
                      // Single question + single select → answering IS submitting.
                      if (!q.multiSelect && questions.length === 1) submit(next);
                    }}
                    className={cn(
                      'text-left px-2 py-1 rounded-md text-2xs transition-colors disabled:opacity-40',
                      isOn ? 'bg-th-accent-soft text-th-accent ring-1 ring-th-accent/40' : 'bg-th-elevated text-th-hi2 hover:bg-th-overlay hover:text-th-hi',
                    )}
                  >
                    <span className="font-medium">{opt.label}</span>
                    {opt.description && <span className="block text-3xs text-th-hi3">{opt.description}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {(questions.length > 1 || questions.some((q) => q.multiSelect)) && (
          <div className="flex gap-1.5">
            <CardButton primary disabled={busy || !allAnswered} onClick={() => submit(selected)}>Submit</CardButton>
            <CardButton disabled={busy} onClick={() => respond({ behavior: 'deny', message: 'The user dismissed the question.' })}>Dismiss</CardButton>
          </div>
        )}
      </div>
    );
  }

  if (part.request.kind === 'plan') {
    return (
      <div className="my-1.5 rounded-lg border border-th-accent/30 bg-th-accent-soft p-2">
        <p className="flex items-center gap-1.5 text-2xs font-medium text-th-hi mb-1">
          <ClipboardCheck size={12} className="text-th-accent" /> Claude proposed a plan
        </p>
        <div className="md-render max-h-48 overflow-y-auto text-2xs text-th-hi2 leading-relaxed pr-1">
          <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>{part.request.plan}</ReactMarkdown>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <CardButton primary disabled={busy} onClick={() => respond({ behavior: 'allow' }, 'Plan approved')}>
            Approve plan
          </CardButton>
          <CardButton disabled={busy} onClick={() => respond({ behavior: 'deny', message: 'Keep planning — the user wants revisions.' })}>
            Keep planning
          </CardButton>
        </div>
      </div>
    );
  }

  return (
    <div className="my-1.5 rounded-lg border border-th-accent/30 bg-th-accent-soft p-2">
      <p className="flex items-center gap-1.5 text-2xs text-th-hi min-w-0">
        <ShieldQuestion size={12} className="shrink-0 text-th-accent" />
        <span className="font-medium shrink-0">{part.request.toolName}</span>
        {part.request.detail && (
          <span className="truncate font-mono text-th-hi3">· {part.request.detail}</span>
        )}
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <CardButton primary disabled={busy} onClick={() => respond({ behavior: 'allow' })}>Allow</CardButton>
        <CardButton disabled={busy} onClick={() => respond({ behavior: 'deny' })}>Deny</CardButton>
      </div>
    </div>
  );
}

/** Collapsed-by-default extended-thinking block. */
function ThinkingBlock({ text }: { text: string }) {
  return (
    <details className="my-1 group/think">
      <summary className="flex items-center gap-1 cursor-pointer select-none text-3xs text-th-hi3 hover:text-th-hi2 transition-colors list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight size={10} className="transition-transform group-open/think:rotate-90" />
        <span className="text-th-accent/70">✻</span> Thinking
      </summary>
      <div className="mt-1 pl-3 border-l border-th-line text-2xs text-th-hi3 italic whitespace-pre-wrap break-words">
        {text}
      </div>
    </details>
  );
}

function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

function MessageBubble({ msg, streaming }: { msg: ClaudeChatMessage; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-th-elevated px-2.5 py-1.5 text-xs text-th-hi whitespace-pre-wrap break-words">
          {messageText(msg)}
        </div>
      </div>
    );
  }

  const text = messageText(msg);
  const copy = (): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    });
  };

  return (
    <div className="max-w-full text-xs text-th-hi2 leading-relaxed space-y-0.5 group/msg">
      {msg.parts.map((part, i) =>
        part.kind === 'tool' ? (
          <ToolChip key={part.id} part={part} live={streaming} />
        ) : part.kind === 'prompt' ? (
          <PromptCard key={part.requestId} part={part} live={streaming} />
        ) : part.kind === 'thinking' ? (
          part.text ? <ThinkingBlock key={i} text={part.text} /> : null
        ) : part.text ? (
          <div key={i} className="md-render break-words">
            <ReactMarkdown remarkPlugins={MD_PLUGINS} components={MD_COMPONENTS}>{part.text}</ReactMarkdown>
          </div>
        ) : null,
      )}
      {streaming ? (
        <Shimmer
          startedAt={msg.at}
          waiting={msg.parts.some((p) => p.kind === 'prompt' && p.status === 'pending')}
        />
      ) : (
        (msg.durationMs !== undefined || text) && (
          <div className="flex items-center gap-1.5 pt-0.5 text-3xs text-th-hi3 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity">
            {msg.durationMs !== undefined && <span>{(msg.durationMs / 1000).toFixed(1)}s</span>}
            {msg.outputTokens !== undefined && <span>· {formatTokens(msg.outputTokens)} tok</span>}
            {text && (
              <IconButton label={copied ? 'Copied' : 'Copy response'} size="xs" onClick={copy} className="size-5">
                {copied ? <Check size={10} className="text-th-ok" /> : <Copy size={10} />}
              </IconButton>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ── Composer footer ───────────────────────────────────────────────────────────

const MODES = [
  { value: 'ask', label: 'Ask', title: 'Reads run freely — writes & commands ask you first' },
  { value: 'auto', label: 'Auto', title: '⚠ Tools run autonomously (bypass permissions)' },
  { value: 'plan', label: 'Plan', title: 'Research + a plan — approve it before changes' },
] as const;

function ModeSwitch() {
  const chatMode = useClaudeStore((s) => s.chatMode);
  const setChatMode = useClaudeStore((s) => s.setChatMode);
  return (
    <Segmented
      label="Mode"
      size="xs"
      value={chatMode}
      onChange={setChatMode}
      options={MODES.map((m) => ({ value: m.value, label: m.label, title: `${m.title} (shift+tab cycles)` }))}
      // Auto (bypass permissions) keeps its warn look while selected. Local until
      // Segmented options take a `tone` (ui gap).
      className={cn(
        chatMode === 'auto' &&
          '[&>[aria-checked=true]]:bg-th-warn-soft [&>[aria-checked=true]]:text-th-warn [&>[aria-checked=true]]:ring-th-warn/40',
      )}
    />
  );
}

// ── Widget ────────────────────────────────────────────────────────────────────

export function ClaudeWidget() {
  const status = useClaudeStatus();
  const messages = useClaudeStore((s) => s.messages);
  const isStreaming = useClaudeStore((s) => s.isStreaming);
  const chatMode = useClaudeStore((s) => s.chatMode);
  const chatModel = useClaudeStore((s) => s.chatModel);
  const chatEffort = useClaudeStore((s) => s.chatEffort);
  const setChatMode = useClaudeStore((s) => s.setChatMode);
  const { send, stop } = useSendClaudeMessage();
  const meta = useClaudeMeta();

  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState<'model' | 'usage' | null>(null);
  const [slashSel, setSlashSel] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const modelBtnRef = useRef<HTMLButtonElement | null>(null);
  const usageBtnRef = useRef<HTMLButtonElement | null>(null);
  // Stick to the bottom while streaming — but stop following the moment the
  // user scrolls up to re-read something.
  const [pinned, setPinned] = useState(true);

  // Slash menu shows while the draft is exactly "/partial-command" (no spaces).
  const slashMatch = /^\/([a-zA-Z0-9_:-]*)$/.exec(draft);
  const slashQuery = slashMatch?.[1] ?? null;
  const slashItems = useMemo(
    () => (slashQuery !== null ? filterSlashItems(meta.data?.slashCommands ?? [], slashQuery) : []),
    [meta.data, slashQuery],
  );

  useEffect(() => {
    if (!pinned) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pinned]);

  useEffect(() => setSlashSel(0), [slashQuery]);

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

  const pickSlash = (name: string): void => {
    setDraft(`/${name} `);
  };

  const cycleMode = (): void => {
    const order = ['ask', 'auto', 'plan'] as const;
    setChatMode(order[(order.indexOf(chatMode) + 1) % order.length]);
  };

  const onComposerKeyDown = (e: React.KeyboardEvent): void => {
    if (slashQuery !== null && slashItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashSel((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashSel((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        pickSlash(slashItems[slashSel % slashItems.length].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDraft(draft + ' '); // breaks the /-only pattern → menu closes
        return;
      }
    }
    if (e.key === 'Escape' && isStreaming) {
      e.preventDefault();
      stop();
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) {
      // Claude Code parity: shift+tab cycles chat → auto → plan.
      e.preventDefault();
      cycleMode();
      return;
    }
    // Enter = send · Shift+Enter = newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (status.data?.available === false) {
    return (
      <EmptyState
        compact
        className="h-full"
        icon={<Terminal size={16} />}
        title="Claude Code not found"
        detail="Install it from claude.com/claude-code, then log in."
        action={
          window.electron ? (
            <Button size="sm" icon={<Terminal size={12} />} onClick={() => void openClaudeCliLogin()}>
              Log in to Claude CLI
            </Button>
          ) : undefined
        }
      />
    );
  }

  const lastId = messages[messages.length - 1]?.id;

  return (
    <div
      className="h-full flex flex-col"
      onKeyDown={(e) => {
        // Esc anywhere in the widget interrupts (composer has its own handler
        // with slash-menu priority; this catches focus-elsewhere cases).
        if (e.key === 'Escape' && isStreaming && !slashQuery) stop();
      }}
    >
      {/* Message list */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-2.5 pt-2 space-y-2.5"
      >
        {messages.length === 0 ? (
          <EmptyState
            compact
            className="h-full"
            icon={<span className="text-th-accent text-lg">✻</span>}
            title="Ask Claude anything"
            detail="/ for commands & skills · shift+tab cycles mode"
          />
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
      <div className="relative shrink-0 px-2 pb-1 pt-1.5 flex items-end gap-1.5">
        {slashQuery !== null && (
          <SlashMenu query={slashQuery} selected={slashSel} onPick={pickSlash} />
        )}
        <Textarea
          size="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKeyDown}
          placeholder={isStreaming ? 'Streaming… (esc to stop)' : 'Ask Claude — / for commands'}
          aria-label="Message Claude"
          rows={2}
          spellCheck={false}
          className="flex-1 resize-none text-xs"
        />
        {isStreaming ? (
          <IconButton label="Stop" size="sm" variant="subtle" tone="danger" onClick={stop} className="text-th-loss">
            <Square size={12} />
          </IconButton>
        ) : (
          <IconButton
            label="Send"
            size="sm"
            variant={draft.trim() ? 'soft' : 'subtle'}
            onClick={handleSend}
            disabled={!draft.trim()}
          >
            <SendHorizontal size={12} />
          </IconButton>
        )}
      </div>

      {/* Composer footer: mode · model+effort · usage */}
      <div className="relative shrink-0 px-2.5 pb-1.5 flex items-center gap-1.5">
        <ModeSwitch />
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            ref={modelBtnRef}
            variant="ghost"
            size="xs"
            onClick={() => setPanel(panel === 'model' ? null : 'model')}
            title="Model & effort"
            aria-label="Model & effort"
            aria-expanded={panel === 'model'}
            icon={<SlidersHorizontal size={10} />}
            className={cn('text-3xs', panel === 'model' ? 'bg-th-elevated text-th-hi' : 'text-th-hi3')}
          >
            {modelLabel(chatModel)}
            {chatEffort && ` · ${chatEffort}`}
          </Button>
          <IconButton
            ref={usageBtnRef}
            label="Usage"
            size="xs"
            active={panel === 'usage'}
            aria-expanded={panel === 'usage'}
            onClick={() => setPanel(panel === 'usage' ? null : 'usage')}
          >
            <PieChart size={11} />
          </IconButton>
        </div>
        {panel === 'model' && <ModelEffortPanel anchor={modelBtnRef.current} onClose={() => setPanel(null)} />}
        {panel === 'usage' && <UsagePanel anchor={usageBtnRef.current} onClose={() => setPanel(null)} />}
      </div>
    </div>
  );
}
