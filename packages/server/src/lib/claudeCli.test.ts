import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import type { ClaudeStreamEvent } from '@dash/shared';
import {
  buildCmdLine,
  ensureEnvPreload,
  resolveSpawnShape,
  quoteCmdArg,
  resetCliCache,
  spawnClaudeChat,
  ASK_MODE_ALLOWED_TOOLS,
  buildChildEnv,
  buildChatArgs,
  buildControlResponseLine,
  buildPromptRequest,
  toolFullInput,
  toolInputWithFlag,
  buildUserMessageLine,
  classifyCliError,
  extractControlCancel,
  extractControlRequest,
  createLineSplitter,
  extractInitMeta,
  isSessionNotFoundError,
  parseStreamJsonLine,
  settleErroredResult,
  toolDetail,
} from './claudeCli';

// Pure parser/splitter tests only — no real CLI spawns (CI has no `claude`).

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
    expect(parseStreamJsonLine(lines[0])).toEqual([{ type: 'done', isError: false, durationMs: 5, outputTokens: null, contextTokens: null }]);
  });
});

describe('parseStreamJsonLine — mapping table', () => {
  it('system/init → [init] with session id and model', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'abc-123',
      model: 'claude-opus-4-8',
      cwd: '/home/x',
      tools: [],
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: 'init', sessionId: 'abc-123', model: 'claude-opus-4-8' }]);
  });

  it('stream_event content_block_delta text_delta → [delta]', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      session_id: 'abc-123',
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: 'delta', text: 'Hel' }]);
  });

  it('thinking_delta → [thinking] (extended-thinking stream)', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: 'thinking', text: 'hmm' }]);
  });

  it('non-text stream_events (message_start, content_block_stop, signature deltas) → []', () => {
    for (const event of [
      { type: 'message_start', message: {} },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'xyz' } },
      { type: 'message_stop' },
    ]) {
      expect(parseStreamJsonLine(JSON.stringify({ type: 'stream_event', event }))).toEqual([]);
    }
  });

  it('assistant text blocks are NOT re-emitted (text streams via deltas); tool_use → [tool-use]', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me write that. ' },
          { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'C:\\Users\\x\\notes\\todo.md', content: '# hi' } },
        ],
      },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: 'tool-use', id: 't1', name: 'Write', detail: 'todo.md' }]);
  });

  it('assistant with several tool_use blocks → one tool-use each, in order', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'ls -la' } },
          { type: 'tool_use', id: 'b', name: 'Read', input: { file_path: '/etc/hosts' } },
        ],
      },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { type: 'tool-use', id: 'a', name: 'Bash', detail: 'ls -la' },
      { type: 'tool-use', id: 'b', name: 'Read', detail: 'hosts' },
    ]);
  });

  it('assistant with only text → [] (nothing to surface; deltas already carried it)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([]);
  });

  it('user tool_result → [tool-result] keyed by tool_use_id', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: 'tool-result', id: 't1', isError: false }]);
  });

  it('user tool_result with is_error → tool-result isError true', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: 'boom', is_error: true }] },
    });
    expect(parseStreamJsonLine(line)).toEqual([{ type: 'tool-result', id: 't9', isError: true }]);
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
    expect(mapped).toHaveLength(1);
    expect(mapped[0].type).toBe('error');
    if (mapped[0].type === 'error') {
      expect(mapped[0].message).toMatch(/claude \/login/);
    }
  });

  it('result → [done] with is_error and duration_ms', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 2882,
      result: 'Hello world',
      total_cost_usd: 0,
      usage: { input_tokens: 4, output_tokens: 356, cache_read_input_tokens: 18_000, cache_creation_input_tokens: 2_000 },
    });
    expect(parseStreamJsonLine(line)).toEqual([
      { type: 'done', isError: false, durationMs: 2882, outputTokens: 356, contextTokens: 20_004 },
    ]);
  });

  it('error result → done with isError true', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 10 });
    expect(parseStreamJsonLine(line)).toEqual([{ type: 'done', isError: true, durationMs: 10, outputTokens: null, contextTokens: null }]);
  });

  it('unknown top-level types → [] (forward-compatible)', () => {
    expect(parseStreamJsonLine('{"type":"brand_new_thing"}')).toEqual([]);
    expect(parseStreamJsonLine('{"type":"system","subtype":"compact_boundary"}')).toEqual([]);
    expect(parseStreamJsonLine('{"type":"user","message":{}}')).toEqual([]); // user with no content array
  });

  it('unparseable / empty / non-object lines → []', () => {
    for (const bad of ['not json at all', '', '   ', '42', '"string"', 'null']) {
      expect(parseStreamJsonLine(bad)).toEqual([]);
    }
  });
});

describe('toolDetail', () => {
  it('file tools → basename of the path', () => {
    expect(toolDetail('Write', { file_path: 'C:\\a\\b\\notes.md' })).toBe('notes.md');
    expect(toolDetail('Edit', { file_path: '/home/x/y/app.ts' })).toBe('app.ts');
    expect(toolDetail('Read', { file_path: 'plain.txt' })).toBe('plain.txt');
    expect(toolDetail('NotebookEdit', { notebook_path: '/n/deep.ipynb' })).toBe('deep.ipynb');
  });

  it('shells → the command, whitespace-collapsed and capped at 200', () => {
    expect(toolDetail('Bash', { command: 'echo hi' })).toBe('echo hi');
    expect(toolDetail('PowerShell', { command: 'Get-ChildItem\n  -Path .' })).toBe('Get-ChildItem -Path .');
    expect(toolDetail('Bash', { command: 'a'.repeat(300) })).toHaveLength(200);
  });

  it('search → pattern; web → url then query; task → description', () => {
    expect(toolDetail('Grep', { pattern: 'TODO' })).toBe('TODO');
    expect(toolDetail('WebFetch', { url: 'https://x.test' })).toBe('https://x.test');
    expect(toolDetail('WebSearch', { query: 'weather' })).toBe('weather');
    expect(toolDetail('Task', { description: 'find bugs' })).toBe('find bugs');
  });

  it('unknown tool or missing/invalid input → empty string', () => {
    expect(toolDetail('MysteryTool', { foo: 1 })).toBe('');
    expect(toolDetail('Write', {})).toBe('');
    expect(toolDetail('Bash', null)).toBe('');
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

describe('buildChatArgs', () => {
  const BASE = [
    '-p', '--output-format', 'stream-json', '--input-format', 'stream-json',
    '--include-partial-messages', '--verbose',
  ];
  const ASK = ['--permission-prompt-tool', 'stdio', '--allowedTools', ASK_MODE_ALLOWED_TOOLS];

  it('ask is the default: stdio prompt tool + read-only allowlist, no permission-mode', () => {
    expect(buildChatArgs({})).toEqual([...BASE, ...ASK]);
    expect(buildChatArgs({ mode: 'ask' })).toEqual([...BASE, ...ASK]);
  });

  it('auto → bypassPermissions (no prompt tool); plan → plan + prompt tool (ExitPlanMode approval)', () => {
    expect(buildChatArgs({ mode: 'auto' })).toEqual([...BASE, '--permission-mode', 'bypassPermissions']);
    expect(buildChatArgs({ mode: 'plan' })).toEqual([
      ...BASE, '--permission-mode', 'plan', '--permission-prompt-tool', 'stdio',
    ]);
  });

  it('model, effort, add-dirs, and resume append their flags in order', () => {
    expect(buildChatArgs({
      mode: 'auto', model: 'opus', effort: 'xhigh', sessionId: 'abc-123',
      additionalDirs: ['/Users/x', '/Users/x/Code'],
    })).toEqual([
      ...BASE,
      '--permission-mode', 'bypassPermissions',
      '--model', 'opus',
      '--effort', 'xhigh',
      '--add-dir', '/Users/x',
      '--add-dir', '/Users/x/Code',
      '--resume', 'abc-123',
    ]);
  });
});

describe('control protocol pure functions (wire shapes captured from CLI 2.1.207)', () => {
  it('buildUserMessageLine wraps text as a stream-json user line', () => {
    expect(buildUserMessageLine('hi')).toBe(
      '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n',
    );
  });

  // Verbatim capture from the probe run (trimmed suggestion payload).
  const CAPTURED_REQUEST = {
    type: 'control_request',
    request_id: '42dc2bad-739e-4ceb-93eb-aa854b3afb38',
    request: {
      subtype: 'can_use_tool',
      tool_name: 'Write',
      display_name: 'Write',
      input: { file_path: '/ws/probe2.txt', content: 'hello.' },
      description: 'probe2.txt',
      permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
      tool_use_id: 'toolu_016hGQDpzEmbvrLZGHWTR5is',
    },
  };

  it('extractControlRequest parses a captured can_use_tool line', () => {
    expect(extractControlRequest(CAPTURED_REQUEST)).toEqual({
      requestId: '42dc2bad-739e-4ceb-93eb-aa854b3afb38',
      toolName: 'Write',
      input: { file_path: '/ws/probe2.txt', content: 'hello.' },
      description: 'probe2.txt',
    });
  });

  it('extractControlRequest → null for non-control / malformed frames', () => {
    expect(extractControlRequest({ type: 'result' })).toBeNull();
    expect(extractControlRequest({ type: 'control_request', request: { subtype: 'other' } })).toBeNull();
    expect(extractControlRequest({ type: 'control_request', request_id: 'x', request: { subtype: 'can_use_tool' } })).toBeNull();
    expect(extractControlRequest(null)).toBeNull();
  });

  it('extractControlCancel picks up control_cancel_request ids', () => {
    expect(extractControlCancel({ type: 'control_cancel_request', request_id: 'abc' })).toBe('abc');
    expect(extractControlCancel({ type: 'control_request', request_id: 'abc' })).toBeNull();
  });

  it('buildPromptRequest: tool card prefers the CLI description, falls back to toolDetail', () => {
    expect(buildPromptRequest('Write', { file_path: '/a/b/c.txt' }, 'c.txt')).toEqual({
      kind: 'tool', toolName: 'Write', detail: 'c.txt', input: '/a/b/c.txt',
    });
    expect(buildPromptRequest('Bash', { command: 'npm test' }, null)).toEqual({
      kind: 'tool', toolName: 'Bash', detail: 'npm test', input: 'npm test',
    });
  });

  it('toolFullInput: keeps the whole command and caps very long input', () => {
    const long = 'x'.repeat(5000);
    const out = toolFullInput('Bash', { command: long });
    expect(out.startsWith('xxx')).toBe(true);
    expect(out).toContain('...truncated');
    expect(out.length).toBeLessThan(4200);
    expect(toolFullInput('Bash', { command: 'a\nb' })).toBe('a\nb');
  });

  it('buildPromptRequest sets truncated only when the input was cut', () => {
    expect(toolInputWithFlag('Bash', { command: 'x'.repeat(5000) }).truncated).toBe(true);
    expect(toolInputWithFlag('Bash', { command: 'ls' })).toEqual({ text: 'ls', truncated: false });
    const big = buildPromptRequest('Bash', { command: 'x'.repeat(5000) }, null);
    expect(big).toMatchObject({ kind: 'tool', truncated: true });
    const small = buildPromptRequest('Bash', { command: 'ls' }, null);
    expect(small).not.toHaveProperty('truncated');
  });

  it('buildPromptRequest: AskUserQuestion → question card; malformed questions degrade to tool card', () => {
    const input = {
      questions: [{
        question: 'Red or blue?',
        header: 'Color',
        multiSelect: false,
        options: [{ label: 'Red', description: 'r' }, { label: 'Blue', description: 'b' }],
      }],
    };
    expect(buildPromptRequest('AskUserQuestion', input, null)).toEqual({
      kind: 'question',
      questions: [{
        question: 'Red or blue?', header: 'Color', multiSelect: false,
        options: [{ label: 'Red', description: 'r' }, { label: 'Blue', description: 'b' }],
      }],
    });
    expect(buildPromptRequest('AskUserQuestion', { questions: [42] }, null)).toEqual({
      kind: 'tool', toolName: 'AskUserQuestion', detail: '',
      input: JSON.stringify({ questions: [42] }, null, 2),
    });
  });

  it('buildPromptRequest: ExitPlanMode → plan card', () => {
    expect(buildPromptRequest('ExitPlanMode', { plan: '# Plan\n- do it' }, null)).toEqual({
      kind: 'plan', plan: '# Plan\n- do it',
    });
  });

  it('buildControlResponseLine: allow echoes the original input as updatedInput', () => {
    const line = buildControlResponseLine('req-1', { toolName: 'Write', input: { file_path: '/x' } }, { behavior: 'allow' });
    expect(JSON.parse(line)).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req-1',
        response: { behavior: 'allow', updatedInput: { file_path: '/x' } },
      },
    });
  });

  it('buildControlResponseLine: AskUserQuestion answers keyed by question text (multi joins with ", ")', () => {
    const pending = {
      toolName: 'AskUserQuestion',
      input: { questions: [{ question: 'Red or blue?' }, { question: 'Pick fruits' }] },
    };
    const line = buildControlResponseLine('req-2', pending, { behavior: 'allow', answers: [['Blue'], ['Apple', 'Pear']] });
    const inner = (JSON.parse(line) as { response: { response: { updatedInput: Record<string, unknown> } } }).response.response;
    expect(inner.updatedInput.answers).toEqual({ 'Red or blue?': 'Blue', 'Pick fruits': 'Apple, Pear' });
    expect(inner.updatedInput.questions).toEqual(pending.input.questions);
  });

  it('buildControlResponseLine: deny carries the message (with a default)', () => {
    interface Wire { response: { response: { behavior: string; message: string } } }
    const denied = JSON.parse(buildControlResponseLine('r', { toolName: 'Write', input: {} }, { behavior: 'deny', message: 'no' })) as Wire;
    expect(denied.response.response).toEqual({ behavior: 'deny', message: 'no' });
    const defaulted = JSON.parse(buildControlResponseLine('r', { toolName: 'Write', input: {} }, { behavior: 'deny' })) as Wire;
    expect(defaulted.response.response.message).toMatch(/denied/i);
  });
});

describe('extractInitMeta', () => {
  it('maps slash_commands, tags skills, and keeps the resolved model', () => {
    const meta = extractInitMeta({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-8',
      slash_commands: ['compact', 'model', 'dataviz', 'code-review'],
      skills: ['dataviz', 'code-review'],
    });
    expect(meta).toEqual({
      model: 'claude-opus-4-8',
      slashCommands: [
        { name: 'compact', isSkill: false },
        { name: 'model', isSkill: false },
        { name: 'dataviz', isSkill: true },
        { name: 'code-review', isSkill: true },
      ],
    });
  });

  it('non-init lines and junk → null', () => {
    expect(extractInitMeta({ type: 'system', subtype: 'status' })).toBeNull();
    expect(extractInitMeta({ type: 'result' })).toBeNull();
    expect(extractInitMeta(null)).toBeNull();
    expect(extractInitMeta('str')).toBeNull();
  });

  it('missing skills/commands arrays degrade to empty/false, not throw', () => {
    const meta = extractInitMeta({ type: 'system', subtype: 'init', model: 7, slash_commands: ['a', 42] });
    expect(meta).toEqual({ model: null, slashCommands: [{ name: 'a', isSkill: false }] });
  });
});

describe('ASK_MODE_ALLOWED_TOOLS', () => {
  it('pre-allows reads only, never network tools', () => {
    expect(ASK_MODE_ALLOWED_TOOLS.split(' ')).toEqual(['Read', 'Glob', 'Grep']);
  });
});

describe('buildChildEnv', () => {
  it('drops injected credentials and runtime flags, keeps what the CLI needs', () => {
    const env = buildChildEnv({
      PATH: '/bin',
      USERPROFILE: '/home/x',
      APPDATA: '/home/x/AppData',
      HTTPS_PROXY: 'http://proxy',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
      ANTHROPIC_API_KEY: 'sk',
      NODE_ENV: 'production',
      ELECTRON_RUN_AS_NODE: '1',
      SERVER_PORT: '7432',
      DASH_API_TOKEN: 'a',
      INBOX_PASSWORD: 'pw',
      ALPACA_API_SECRET: 's',
      GITHUB_TOKEN: 'g',
    });
    expect(env).toEqual({
      PATH: '/bin',
      USERPROFILE: '/home/x',
      APPDATA: '/home/x/AppData',
      HTTPS_PROXY: 'http://proxy',
      CLAUDE_CODE_OAUTH_TOKEN: 'tok',
    });
  });
});

describe('quoteCmdArg / buildCmdLine (cmd.exe fallback for a .cmd shim)', () => {
  it('caret-escapes cmd metacharacters so an "&" stays inside one argument', () => {
    expect(quoteCmdArg('C:\\R&D')).toBe('^"C:\\R^&D^"');
    expect(quoteCmdArg('50%')).toBe('^"50^%^"');
    expect(quoteCmdArg('a|b<c>d^e!')).toBe('^"a^|b^<c^>d^^e^!^"');
  });

  it('wraps the whole command line in one pair of quotes for /s', () => {
    const line = buildCmdLine('C:\\bin\\claude.cmd', ['--add-dir', 'C:\\R&D']);
    expect(line.startsWith('"')).toBe(true);
    expect(line.endsWith('"')).toBe(true);
    expect(line).toContain('^&');
    expect(line).not.toMatch(/[^^]&/);
  });

  it.runIf(process.platform === 'win32')('cmd.exe passes an "&" path through as exactly one argv element (Windows-only)', () => {
    const script = 'console.log(JSON.stringify(process.argv.slice(1)))';
    const tricky = ['C:\\Users\\x\\R&D', '50% ^x', 'a "quoted" b', 'trailing\\'];
    const res = spawnSync('cmd.exe', ['/d', '/s', '/c', buildCmdLine(process.execPath, ['-e', script, ...tricky])], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    expect(JSON.parse(res.stdout.trim())).toEqual(tricky);
  });
});

describe('ELECTRON_RUN_AS_NODE preload (npm shim path)', () => {
  it('the CLI process sees no ELECTRON_RUN_AS_NODE, so its tool subprocesses cannot inherit it', async () => {
    const preload = await ensureEnvPreload();
    const res = spawnSync(
      process.execPath,
      ['--require', preload, '-e', 'console.log(JSON.stringify(process.env.ELECTRON_RUN_AS_NODE ?? null))'],
      { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } },
    );
    expect(JSON.parse(res.stdout.trim())).toBeNull();
  });

  it.runIf(process.platform === 'win32')('shim spawn shape loads the preload before cli.js (Windows-only)', async () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'fake-shim-'));
    try {
      const cliDir = path.join(d, 'node_modules', '@anthropic-ai', 'claude-code');
      mkdirSync(cliDir, { recursive: true });
      writeFileSync(path.join(cliDir, 'cli.js'), '');
      const shape = await resolveSpawnShape(path.join(d, 'claude.cmd'), ['-p']);
      expect(shape.args.slice(0, 2)).toEqual(['--require', await ensureEnvPreload()]);
      expect(shape.args[2]).toBe(path.join(cliDir, 'cli.js'));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('spawnClaudeChat — spawn failure', () => {
  let dir = '';
  let savedPath: string | undefined;

  afterEach(() => {
    if (savedPath !== undefined) process.env.PATH = savedPath;
    resetCliCache();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('a NUL byte in workspaceDir yields an error frame and onExit instead of an unhandled rejection', async () => {
    // A stand-in `claude` on PATH so discovery succeeds (CI has no real CLI).
    dir = mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
    const file = path.join(dir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
    writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    savedPath = process.env.PATH;
    process.env.PATH = `${dir}${path.delimiter}${savedPath ?? ''}`;
    resetCliCache();

    const events: ClaudeStreamEvent[] = [];
    await new Promise<void>((resolve) => {
      spawnClaudeChat({
        message: 'hi',
        mode: 'ask',
        workspaceDir: 'bad\u0000dir',
        onEvent: (e) => events.push(e),
        onExit: resolve,
      });
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0]).toMatchObject({ message: expect.stringContaining('Failed to start Claude CLI') });
  });
});

describe('settleErroredResult (decided at close, once stderr is fully drained)', () => {
  const done = { type: 'done', isError: true, durationMs: 3, outputTokens: null, contextTokens: null } as const;

  it('tags a session-not-found stderr that arrived after the result frame', () => {
    const stderr = 'No conversation found with session ID: abc-123\n';
    expect(settleErroredResult(done, stderr)).toEqual({
      event: { type: 'error', message: classifyCliError(stderr) },
      meta: { code: 'session-not-found' },
    });
  });

  it('keeps the tag even when the classified message is truncated', () => {
    const stderr = `${'x'.repeat(600)} No conversation found`;
    const settled = settleErroredResult(done, stderr);
    expect(settled.meta?.code).toBe('session-not-found');
  });

  it('passes the done frame through for any other stderr (including empty)', () => {
    expect(settleErroredResult(done, 'rate limit exceeded')).toEqual({ event: done });
    expect(settleErroredResult(done, '')).toEqual({ event: done });
  });
});
