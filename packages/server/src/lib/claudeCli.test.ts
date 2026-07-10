import { describe, expect, it } from 'vitest';
import {
  classifyCliError,
  createLineSplitter,
  isSessionNotFoundError,
  parseStreamJsonLine,
  pickWindowsClaude,
} from './claudeCli';

// Pure parser/splitter tests only — no real CLI spawns (CI has no `claude`).

describe('pickWindowsClaude', () => {
  it('prefers a native .exe over the npm .cmd shim', () => {
    expect(
      pickWindowsClaude([
        'C:\\Users\\n\\AppData\\Roaming\\npm\\claude',
        'C:\\Users\\n\\AppData\\Roaming\\npm\\claude.cmd',
        'C:\\Program Files\\claude\\claude.exe',
      ]),
    ).toBe('C:\\Program Files\\claude\\claude.exe');
  });

  it('falls back to .cmd when no .exe is present', () => {
    expect(
      pickWindowsClaude([
        'C:\\Users\\n\\AppData\\Roaming\\npm\\claude', // extensionless sh shim — not spawnable
        'C:\\Users\\n\\AppData\\Roaming\\npm\\claude.cmd',
      ]),
    ).toBe('C:\\Users\\n\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('returns null when only the unspawnable extensionless shim exists', () => {
    expect(pickWindowsClaude(['C:\\Users\\n\\AppData\\Roaming\\npm\\claude'])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickWindowsClaude([])).toBeNull();
  });
});

describe('createLineSplitter', () => {
  it('reassembles a JSON line split across chunk boundaries', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((l) => lines.push(l));
    splitter.push('{"type":"str');
    splitter.push('eam_event","x":1}\n{"type":"re');
    splitter.push('sult"}\n');
    expect(lines).toEqual(['{"type":"stream_event","x":1}', '{"type":"result"}']);
  });

  it('emits multiple lines arriving in one chunk', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((l) => lines.push(l));
    splitter.push('a\nb\nc\n');
    expect(lines).toEqual(['a', 'b', 'c']);
  });

  it('flush() emits a trailing unterminated line, once', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((l) => lines.push(l));
    splitter.push('no trailing newline');
    expect(lines).toEqual([]);
    splitter.flush();
    splitter.flush();
    expect(lines).toEqual(['no trailing newline']);
  });

  it('handles CRLF output (Windows CLI) — parser trims the \\r', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((l) => lines.push(l));
    splitter.push('{"type":"result","is_error":false,"duration_ms":5}\r\n');
    expect(lines).toHaveLength(1);
    expect(parseStreamJsonLine(lines[0])).toEqual({ type: 'done', isError: false, durationMs: 5 });
  });
});

describe('parseStreamJsonLine — mapping table', () => {
  it('system/init → init with session id and model', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123',
      model: 'claude-opus-4-8',
      cwd: '/home/x',
      tools: [],
    });
    expect(parseStreamJsonLine(line)).toEqual({ type: 'init', sessionId: 'abc-123', model: 'claude-opus-4-8' });
  });

  it('stream_event content_block_delta text_delta → delta', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      session_id: 'abc-123',
    });
    expect(parseStreamJsonLine(line)).toEqual({ type: 'delta', text: 'Hel' });
  });

  it('non-text stream_events (message_start, content_block_stop, thinking deltas) are ignored', () => {
    for (const event of [
      { type: 'message_start', message: {} },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
      { type: 'message_stop' },
    ]) {
      expect(parseStreamJsonLine(JSON.stringify({ type: 'stream_event', event }))).toBeNull();
    }
  });

  it('assistant message → message with concatenated text blocks (tool_use skipped)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
          { type: 'text', text: 'world' },
        ],
      },
    });
    expect(parseStreamJsonLine(line)).toEqual({ type: 'message', text: 'Hello world' });
  });

  it('not-logged-in assistant event (error: authentication_failed) → friendly login hint', () => {
    // Real shape observed from claude v2.1.201 with no login: the auth failure
    // arrives as a synthetic assistant message, NOT on stderr.
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: '7c1871e5',
        model: '<synthetic>',
        role: 'assistant',
        content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
      },
      session_id: 'b5251c90',
      error: 'authentication_failed',
    });
    const mapped = parseStreamJsonLine(line);
    expect(mapped?.type).toBe('error');
    if (mapped?.type === 'error') {
      expect(mapped.message).toMatch(/claude \/login/);
    }
  });

  it('result → done with is_error and duration_ms', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 2882,
      result: 'Hello world',
      total_cost_usd: 0,
    });
    expect(parseStreamJsonLine(line)).toEqual({ type: 'done', isError: false, durationMs: 2882 });
  });

  it('error result → done with isError true', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 10 });
    expect(parseStreamJsonLine(line)).toEqual({ type: 'done', isError: true, durationMs: 10 });
  });

  it('unknown top-level types are ignored (forward-compatible)', () => {
    expect(parseStreamJsonLine('{"type":"user","message":{}}')).toBeNull();
    expect(parseStreamJsonLine('{"type":"brand_new_thing"}')).toBeNull();
    expect(parseStreamJsonLine('{"type":"system","subtype":"compact_boundary"}')).toBeNull();
  });

  it('unparseable / empty / non-object lines are ignored', () => {
    expect(parseStreamJsonLine('not json at all')).toBeNull();
    expect(parseStreamJsonLine('')).toBeNull();
    expect(parseStreamJsonLine('   ')).toBeNull();
    expect(parseStreamJsonLine('42')).toBeNull();
    expect(parseStreamJsonLine('"string"')).toBeNull();
    expect(parseStreamJsonLine('null')).toBeNull();
  });
});

describe('classifyCliError', () => {
  it('auth-shaped stderr → friendly login hint', () => {
    for (const stderr of [
      'Error: Please run `claude login` to authenticate',
      'Not logged in. Run /login first.',
      'OAuth token has expired',
      'Authentication failed for this account',
    ]) {
      expect(classifyCliError(stderr)).toBe('Claude Code is not logged in — run `claude /login` in a terminal.');
    }
  });

  it('other stderr passes through trimmed', () => {
    expect(classifyCliError('  something broke\n')).toBe('something broke');
  });

  it('empty stderr gets a generic message', () => {
    expect(classifyCliError('')).toBe('Claude CLI exited unexpectedly with no output');
  });
});

describe('isSessionNotFoundError', () => {
  it('matches the CLI resume-failure phrasings', () => {
    expect(isSessionNotFoundError('No conversation found with session ID: abc-123')).toBe(true);
    expect(isSessionNotFoundError('Error: session abc-123 not found')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isSessionNotFoundError('rate limit exceeded')).toBe(false);
    expect(isSessionNotFoundError('Claude Code is not logged in')).toBe(false);
  });
});
