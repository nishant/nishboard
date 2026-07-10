/** GET /api/claude/status — is the locally installed Claude Code CLI usable? */
export interface ClaudeStatusData {
  available: boolean;
  version: string | null;
  /** Why unavailable: CLI binary not found vs found-but-probe-failed. */
  reason?: 'not-found' | 'error';
}

/** One SSE frame on POST /api/claude/chat — mapped server-side from the CLI's
 *  stream-json output so the renderer never parses raw CLI output. */
export type ClaudeStreamEvent =
  | { type: 'init'; sessionId: string; model: string }
  | { type: 'delta'; text: string }
  /** Authoritative final assistant text — replaces accumulated deltas. */
  | { type: 'message'; text: string }
  | { type: 'done'; isError: boolean; durationMs: number }
  | { type: 'error'; message: string };

export interface ClaudeChatRequestBody {
  message: string;
  /** Resume an existing CLI conversation (`--resume`). */
  sessionId?: string;
}
