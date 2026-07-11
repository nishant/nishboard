/** GET /api/claude/status — is the locally installed Claude Code CLI usable? */
export interface ClaudeStatusData {
  available: boolean;
  version: string | null;
  /** Why unavailable: CLI binary not found vs found-but-probe-failed. */
  reason?: 'not-found' | 'error';
}

/** Widget chat mode:
 *  ask  = default permission mode + `--permission-prompt-tool stdio` — reads run
 *         freely (ASK_MODE_ALLOWED_TOOLS), writes/commands surface an in-widget
 *         Allow/Deny card · auto = bypassPermissions (tools run autonomously) ·
 *  plan = CLI plan mode (research + a plan; ExitPlanMode approval surfaces as a
 *         card). Legacy persisted value 'chat' migrates to 'ask'. */
export type ClaudeChatMode = 'ask' | 'auto' | 'plan';

/** CLI `--effort` levels (2.1.x). */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const CLAUDE_EFFORTS: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Assumed model context window for the usage popover's context meter. */
export const CLAUDE_CONTEXT_WINDOW = 200_000;

/** One SSE frame on POST /api/claude/chat — mapped server-side from the CLI's
 *  stream-json output so the renderer never parses raw CLI output.
 *
 *  Text is streamed purely via `delta` frames (the CLI is spawned with
 *  `--include-partial-messages`, so deltas cover every turn's text in order) —
 *  there is deliberately no "authoritative final text" frame, because a
 *  tool-using response has MULTIPLE assistant turns and a replace-semantics
 *  frame would clobber earlier turns. `tool-use`/`tool-result` interleave with
 *  `delta` to describe what the CLI did between text. */
export type ClaudeStreamEvent =
  | { type: 'init'; sessionId: string; model: string }
  | { type: 'delta'; text: string }
  /** Extended-thinking text (thinking_delta) — rendered as a collapsible
   *  grey block, separate from the answer text. */
  | { type: 'thinking'; text: string }
  /** The model invoked a tool (Write, Bash, a Skill, …). `detail` is a short
   *  human label derived from the tool input (a filename, a command, …). */
  | { type: 'tool-use'; id: string; name: string; detail: string }
  /** A previously-announced tool call finished (`id` matches the `tool-use`). */
  | { type: 'tool-result'; id: string; isError: boolean }
  /** The CLI is waiting on the user — render a prompt card. Answered via
   *  POST /api/claude/control; resolution arrives as `permission-resolved`. */
  | { type: 'permission-request'; requestId: string; request: ClaudePromptRequest }
  /** A pending prompt finished (user response, timeout, or CLI cancellation). */
  | {
      type: 'permission-resolved';
      requestId: string;
      behavior: 'allow' | 'deny';
      reason: 'user' | 'timeout' | 'cancelled';
    }
  | {
      type: 'done';
      isError: boolean;
      durationMs: number;
      outputTokens: number | null;
      /** Total context consumed this turn: input + cache-read + cache-creation
       *  tokens from the result frame's usage (null when absent). */
      contextTokens: number | null;
    }
  | { type: 'error'; message: string };

export interface ClaudeChatRequestBody {
  message: string;
  /** Resume an existing CLI conversation (`--resume`). */
  sessionId?: string;
  /** Permission posture for this turn — see ClaudeChatMode. Default 'ask'.
   *  'chat' is the pre-v3 name for the no-tools mode; the server coerces it
   *  to 'ask' so an un-migrated renderer keeps working. */
  mode?: ClaudeChatMode | 'chat';
  /** CLI `--model` value: an alias ('opus', 'sonnet', 'haiku', 'fable') or a
   *  full model id. Omit for the CLI's default. */
  model?: string;
  /** CLI `--effort` level. Omit for the CLI's default. */
  effort?: ClaudeEffort;
  /** CLI cwd (its file ops are relative to this). `~`-expanded server-side;
   *  default ~/.dash. */
  workspaceDir?: string;
  /** Extra dirs the CLI may touch (`--add-dir` each). Default: home dir. */
  additionalDirs?: string[];
}

/** One question from the CLI's AskUserQuestion tool. */
export interface ClaudeQuestionItem {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: Array<{ label: string; description: string | null }>;
}

/** What the CLI is waiting on — discriminates the in-widget prompt card. */
export type ClaudePromptRequest =
  /** Permission for one tool call (`detail` = human summary, e.g. filename). */
  | { kind: 'tool'; toolName: string; detail: string }
  /** AskUserQuestion — render the questions/options as buttons. */
  | { kind: 'question'; questions: ClaudeQuestionItem[] }
  /** ExitPlanMode — `plan` is markdown; Approve / Keep planning. */
  | { kind: 'plan'; plan: string };

/** POST /api/claude/control body. High-level on purpose: the renderer never
 *  builds the CLI's control_response wire shape — the server owns that mapping
 *  (pinned against CLI 2.1.207) in one pure function. */
export interface ClaudeControlRequestBody {
  requestId: string;
  response:
    | { behavior: 'allow' }
    /** AskUserQuestion: selected option label(s) per question, in order. */
    | { behavior: 'allow'; answers: string[][] }
    | { behavior: 'deny'; message?: string };
}

/** One slash command the CLI reports (built-ins, ~/.claude/commands, skills). */
export interface ClaudeSlashCommand {
  name: string;
  /** True when the command is a user-invocable skill (init frame `skills`). */
  isSkill: boolean;
}

/** GET /api/claude/meta — autocomplete data. Captured from the CLI's init
 *  frame on every chat (persisted server-side), supplemented by scanning
 *  ~/.claude/commands + ~/.claude/skills before any chat has ever run. */
export interface ClaudeMetaData {
  slashCommands: ClaudeSlashCommand[];
  /** Resolved model id of the most recent chat (null before any chat). */
  model: string | null;
}

/** One rate-limit window from the claude.ai OAuth usage endpoint. */
export interface ClaudeUsageWindow {
  /** Raw window key from the API ('five_hour', 'seven_day', …). */
  key: string;
  /** Human label ('Session (5h)', 'Weekly — all models', …). */
  label: string;
  /** Percent used, 0–100. */
  utilization: number;
  /** ISO timestamp when the window resets (null if the API omits it). */
  resetsAt: string | null;
}

/** GET /api/claude/usage — subscription usage (5-hour session + weekly). */
export interface ClaudeUsageData {
  windows: ClaudeUsageWindow[];
}
