/** GET /api/claude/status — is the locally installed Claude Code CLI usable? */
export interface ClaudeStatusData {
  available: boolean;
  version: string | null;
  /** Why unavailable: CLI binary not found vs found-but-probe-failed. */
  reason?: 'not-found' | 'error';
}

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
  /** The model invoked a tool (Write, Bash, a Skill, …). `detail` is a short
   *  human label derived from the tool input (a filename, a command, …). */
  | { type: 'tool-use'; id: string; name: string; detail: string }
  /** A previously-announced tool call finished (`id` matches the `tool-use`). */
  | { type: 'tool-result'; id: string; isError: boolean }
  | { type: 'done'; isError: boolean; durationMs: number }
  | { type: 'error'; message: string };

export interface ClaudeChatRequestBody {
  message: string;
  /** Resume an existing CLI conversation (`--resume`). */
  sessionId?: string;
  /** Let the CLI actually run tools (write files, run commands, invoke skills)
   *  by spawning with `--permission-mode bypassPermissions`. Off ⇒ default
   *  permission mode, which auto-denies write/exec in non-interactive `-p`. */
  allowTools?: boolean;
}
