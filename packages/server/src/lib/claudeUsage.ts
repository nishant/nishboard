/**
 * Subscription usage (5-hour session + weekly windows) via the claude.ai OAuth
 * usage endpoint — the same numbers the Claude apps and the CLI's /usage show.
 * The bearer token is the Claude Code CLI's own login, read from (in order):
 *   1. CLAUDE_CODE_OAUTH_TOKEN env (Settings → Developer, or shell)
 *   2. macOS keychain item "Claude Code-credentials"        (macOS-only)
 *   3. ~/.claude/.credentials.json                          (Windows/Linux)
 *
 * NEVER log the token or include it in any error message.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import type { ClaudeUsageData, ClaudeUsageWindow } from '@dash/shared';
import { HttpError, UpstreamError } from './http';

const execFileAsync = promisify(execFile);

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

function tokenFromCredsJson(text: string): string | null {
  try {
    const creds = JSON.parse(text) as { claudeAiOauth?: { accessToken?: unknown } };
    const token = creds?.claudeAiOauth?.accessToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

async function readOauthToken(): Promise<string | null> {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (envToken) return envToken;

  if (process.platform === 'darwin') {
    // macOS-only: the CLI stores its login in the user keychain.
    try {
      const { stdout } = await execFileAsync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { encoding: 'utf8', timeout: 5_000 },
      );
      const token = tokenFromCredsJson(stdout.trim());
      if (token) return token;
    } catch { /* no keychain item — fall through */ }
  }

  // Windows/Linux primary location (also a macOS fallback for older CLIs).
  try {
    const text = await readFile(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8');
    return tokenFromCredsJson(text);
  } catch {
    return null;
  }
}

/** Human labels for the window keys the endpoint is known to return; unknown
 *  keys still render, via a prettified fallback (forward-compatible). */
const WINDOW_LABELS: Record<string, string> = {
  five_hour: 'Session (5h)',
  seven_day: 'Weekly — all models',
  seven_day_opus: 'Weekly — Opus',
  seven_day_sonnet: 'Weekly — Sonnet',
  seven_day_oauth_apps: 'Weekly — apps',
};

const WINDOW_ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

/** Pure: map the endpoint's response body to ordered usage windows. Any
 *  top-level object value carrying a numeric `utilization` is a window.
 *  Exported for tests. */
export function parseUsageResponse(raw: unknown): ClaudeUsageData {
  const obj = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const windows: ClaudeUsageWindow[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'object' || value === null) continue;
    const w = value as Record<string, unknown>;
    if (typeof w.utilization !== 'number') continue;
    windows.push({
      key,
      label: WINDOW_LABELS[key] ?? key.replace(/_/g, ' '),
      utilization: Math.max(0, Math.min(100, w.utilization)),
      resetsAt: typeof w.resets_at === 'string' ? w.resets_at : null,
    });
  }
  // Normalize fraction-shaped responses (0–1) to percent. Applied across ALL
  // windows, not per-window, so a genuine 0% window next to a 45% one isn't
  // misread as a fraction. Tradeoff: every window genuinely ≤1% would scale
  // ×100 — accepted, since real subscription windows virtually never all sit
  // at ≤1% simultaneously.
  if (windows.length > 0 && windows.every((w) => w.utilization <= 1)) {
    for (const w of windows) w.utilization = Math.min(100, w.utilization * 100);
  }
  windows.sort((a, b) => {
    const ai = WINDOW_ORDER.indexOf(a.key);
    const bi = WINDOW_ORDER.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return { windows };
}

export async function fetchClaudeUsage(): Promise<ClaudeUsageData> {
  const token = await readOauthToken();
  if (!token) {
    throw new HttpError(
      503,
      'No Claude Code login found — run `claude /login` in a terminal (or set CLAUDE_CODE_OAUTH_TOKEN in Settings → Developer).',
    );
  }
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // 401 = expired/revoked login. Deliberately no response-body passthrough —
    // keep any token-adjacent detail out of client-visible errors.
    const hint = res.status === 401
      ? 'Claude Code login expired — run `claude /login` again.'
      : `Usage endpoint returned ${res.status}`;
    throw new UpstreamError(res.status, hint);
  }
  return parseUsageResponse(await res.json());
}
