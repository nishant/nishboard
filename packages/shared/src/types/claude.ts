/** GET /api/claude/status — is the locally installed Claude Code CLI usable? */
export interface ClaudeStatusData {
  available: boolean;
  version: string | null;
  /** Why unavailable: CLI binary not found vs found-but-probe-failed. */
  reason?: 'not-found' | 'error';
}

/** Widget chat mode → CLI `--permission-mode`:
 *  chat = default (tools auto-denied in -p) · auto = bypassPermissions
 *  (tools actually run) · plan = plan mode (research + a plan, no mutations). */
export type ClaudeChatMode = 'chat' | 'auto' | 'plan';

/** CLI `--effort` levels (2.1.x). */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const CLAUDE_EFFORTS: ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

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
  | { type: 'done'; isError: boolean; durationMs: number; outputTokens: number | null }
  | { type: 'error'; message: string };

export interface ClaudeChatRequestBody {
  message: string;
  /** Resume an existing CLI conversation (`--resume`). */
  sessionId?: string;
  /** Permission posture for this turn — see ClaudeChatMode. Default 'chat'. */
  mode?: ClaudeChatMode;
  /** CLI `--model` value: an alias ('opus', 'sonnet', 'haiku', 'fable') or a
   *  full model id. Omit for the CLI's default. */
  model?: string;
  /** CLI `--effort` level. Omit for the CLI's default. */
  effort?: ClaudeEffort;
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
