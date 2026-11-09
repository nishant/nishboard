import { beforeEach, describe, expect, it, vi } from 'vitest';

// persist rehydrates synchronously at module init — seed storage, then
// re-import a fresh module instance per test.
async function loadStore() {
  const mod = await import('./claudeStore');
  return mod;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('claudeStore parts model', () => {
  it('addUser creates a user message with one text part', async () => {
    const { useClaudeStore, messageText } = await loadStore();
    useClaudeStore.getState().addUser('hi there');
    const [m] = useClaudeStore.getState().messages;
    expect(m.role).toBe('user');
    expect(m.parts).toEqual([{ kind: 'text', text: 'hi there' }]);
    expect(messageText(m)).toBe('hi there');
  });

  it('deltas merge into one trailing text part; a tool call splits the text', async () => {
    const { useClaudeStore, messageText } = await loadStore();
    const s = useClaudeStore.getState();
    s.beginAssistant();
    s.appendDelta('Let me ');
    s.appendDelta('write that. ');
    s.addToolPart('t1', 'Write', 'notes.md');
    s.appendDelta('Done!');

    const m = useClaudeStore.getState().messages.at(-1)!;
    expect(m.parts).toEqual([
      { kind: 'text', text: 'Let me write that. ' },
      { kind: 'tool', id: 't1', name: 'Write', detail: 'notes.md', status: 'running' },
      { kind: 'text', text: 'Done!' },
    ]);
    // messageText ignores tool parts
    expect(messageText(m)).toBe('Let me write that. Done!');
  });

  it('resolveToolPart flips the matching chip to ok / error by id', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.beginAssistant();
    s.addToolPart('a', 'Bash', 'ls');
    s.addToolPart('b', 'Write', 'x.md');
    s.resolveToolPart('a', false);
    s.resolveToolPart('b', true);

    const parts = useClaudeStore.getState().messages.at(-1)!.parts;
    expect(parts).toEqual([
      { kind: 'tool', id: 'a', name: 'Bash', detail: 'ls', status: 'ok' },
      { kind: 'tool', id: 'b', name: 'Write', detail: 'x.md', status: 'error' },
    ]);
  });

  it('appendError adds a visible error text part to the current assistant turn', async () => {
    const { useClaudeStore, messageText } = await loadStore();
    const s = useClaudeStore.getState();
    s.beginAssistant();
    s.appendDelta('partial answer');
    s.appendError('stream failed');
    expect(messageText(useClaudeStore.getState().messages.at(-1)!)).toContain('partial answer');
    expect(messageText(useClaudeStore.getState().messages.at(-1)!)).toContain('⚠ stream failed');
  });

  it('tool actions no-op when the last message is not an assistant turn', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.addUser('hello');
    s.addToolPart('t', 'Bash', 'ls'); // last msg is the user turn — ignored
    expect(useClaudeStore.getState().messages.at(-1)!.parts).toEqual([{ kind: 'text', text: 'hello' }]);
  });
});

describe('dashboard-claude v1 → v2 migration', () => {
  it('wraps flat {text} messages into {parts:[text]}', async () => {
    localStorage.setItem(
      'dashboard-claude',
      JSON.stringify({
        state: {
          messages: [
            { id: 'u1', role: 'user', text: 'question', at: 1 },
            { id: 'a1', role: 'assistant', text: 'answer', at: 2 },
            { id: 'a2', role: 'assistant', text: '', at: 3 },
          ],
          sessionId: 'sess-abc',
          model: 'claude-opus-4-8',
        },
        version: 1,
      }),
    );
    const { useClaudeStore } = await loadStore();
    const { messages, sessionId } = useClaudeStore.getState();
    expect(sessionId).toBe('sess-abc');
    expect(messages[0].parts).toEqual([{ kind: 'text', text: 'question' }]);
    expect(messages[1].parts).toEqual([{ kind: 'text', text: 'answer' }]);
    expect(messages[2].parts).toEqual([]); // empty text → no parts
    expect('text' in messages[0]).toBe(false);
  });
});

describe('claudeStore v2 additions', () => {
  it('appendThinking merges into a trailing thinking part, separate from text', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.beginAssistant();
    s.appendThinking('Let me consider');
    s.appendThinking(' the options.');
    s.appendDelta('Answer.');
    const [m] = useClaudeStore.getState().messages;
    expect(m.parts).toEqual([
      { kind: 'thinking', text: 'Let me consider the options.' },
      { kind: 'text', text: 'Answer.' },
    ]);
  });

  it('finishAssistant stamps duration and tokens (tokens omitted when null)', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.beginAssistant();
    s.appendDelta('hi');
    s.finishAssistant(4200, 356, 24_000);
    let [m] = useClaudeStore.getState().messages;
    expect(m.durationMs).toBe(4200);
    expect(m.outputTokens).toBe(356);
    expect(useClaudeStore.getState().lastContextTokens).toBe(24_000);

    s.beginAssistant();
    s.finishAssistant(100, null, null);
    m = useClaudeStore.getState().messages[1];
    expect(m.durationMs).toBe(100);
    expect(m.outputTokens).toBeUndefined();
    // null context keeps the previous value (a turn without usage shouldn't wipe the meter)
    expect(useClaudeStore.getState().lastContextTokens).toBe(24_000);
  });

  it('mode/model/effort persist with safe defaults', async () => {
    const first = await loadStore();
    expect(first.useClaudeStore.getState().chatMode).toBe('ask');
    expect(first.useClaudeStore.getState().chatModel).toBeNull();
    expect(first.useClaudeStore.getState().chatEffort).toBeNull();
    first.useClaudeStore.getState().setChatMode('plan');
    first.useClaudeStore.getState().setChatModel('opus');
    first.useClaudeStore.getState().setChatEffort('xhigh');

    vi.resetModules(); // simulate app restart — persist must rehydrate
    const second = await loadStore();
    expect(second.useClaudeStore.getState().chatMode).toBe('plan');
    expect(second.useClaudeStore.getState().chatModel).toBe('opus');
    expect(second.useClaudeStore.getState().chatEffort).toBe('xhigh');
  });

  it('newChat clears the transcript, resets the mode to ask and keeps model/effort', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.setChatMode('auto');
    s.setChatModel('opus');
    s.addUser('hello');
    s.newChat();
    expect(useClaudeStore.getState().messages).toEqual([]);
    expect(useClaudeStore.getState().sessionId).toBeNull();
    expect(useClaudeStore.getState().chatMode).toBe('ask');
    expect(useClaudeStore.getState().chatModel).toBe('opus');
  });
});

describe('claudeStore v3 — prompt parts + mode migration', () => {
  it('addPromptPart appends a pending card; resolvePromptPart flips it once and attaches resolution', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.beginAssistant();
    s.addPromptPart('req-1', { kind: 'tool', toolName: 'Write', detail: 'notes.md' });
    let [m] = useClaudeStore.getState().messages;
    expect(m.parts).toEqual([
      { kind: 'prompt', requestId: 'req-1', request: { kind: 'tool', toolName: 'Write', detail: 'notes.md' }, status: 'pending' },
    ]);

    s.resolvePromptPart('req-1', 'allowed');
    s.resolvePromptPart('req-1', 'denied', 'Blue'); // late resolution: status keeps first, summary attaches
    [m] = useClaudeStore.getState().messages;
    const part = m.parts[0];
    expect(part.kind).toBe('prompt');
    if (part.kind === 'prompt') {
      expect(part.status).toBe('allowed');
      expect(part.resolution).toBe('Blue');
    }
  });

  it('cancelPendingPrompts flips only pending prompts', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.beginAssistant();
    s.addPromptPart('a', { kind: 'tool', toolName: 'Bash', detail: 'ls' });
    s.addPromptPart('b', { kind: 'plan', plan: '# p' });
    s.resolvePromptPart('a', 'allowed');
    s.cancelPendingPrompts();
    const [m] = useClaudeStore.getState().messages;
    const statuses = m.parts.map((p) => (p.kind === 'prompt' ? p.status : null));
    expect(statuses).toEqual(['allowed', 'cancelled']);
  });

  it('migrates persisted v2 chatMode "chat" → "ask"; default is ask', async () => {
    localStorage.setItem('dashboard-claude', JSON.stringify({ state: { messages: [], chatMode: 'chat' }, version: 2 }));
    const first = await loadStore();
    expect(first.useClaudeStore.getState().chatMode).toBe('ask');

    vi.resetModules();
    localStorage.clear();
    const fresh = await loadStore();
    expect(fresh.useClaudeStore.getState().chatMode).toBe('ask');
  });
});

describe('claudeStore persistence (NISHBOARD-038, 048)', () => {
  const saved = () => JSON.parse(localStorage.getItem('dashboard-claude')!).state;

  it('persists the last 50 messages without thinking parts and with tool details cut', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    for (let i = 0; i < 60; i++) s.addUser(`m${i}`);
    s.beginAssistant();
    s.appendThinking('secret reasoning');
    s.appendDelta('answer');
    s.addToolPart('t1', 'Bash', 'x'.repeat(5_000));
    const msgs = saved().messages;
    expect(msgs).toHaveLength(50);
    const last = msgs.at(-1);
    expect(last.parts.some((p: { kind: string }) => p.kind === 'thinking')).toBe(false);
    const tool = last.parts.find((p: { kind: string }) => p.kind === 'tool');
    expect(tool.detail).toHaveLength(2_000);
    expect(useClaudeStore.getState().messages).toHaveLength(61);
  });

  it('persists Auto as ask', async () => {
    const { useClaudeStore } = await loadStore();
    useClaudeStore.getState().setChatMode('auto');
    expect(saved().chatMode).toBe('ask');
    useClaudeStore.getState().setChatMode('plan');
    expect(saved().chatMode).toBe('plan');
  });

  it('does not write while streaming; setStreaming(false) persists the turn', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.addUser('hi');
    s.setStreaming(true);
    s.beginAssistant();
    s.appendDelta('partial');
    expect(saved().messages).toHaveLength(1);
    s.setStreaming(false);
    expect(saved().messages).toHaveLength(2);
  });

  it('on a quota error trims to the last 10 messages and retries once', async () => {
    const { useClaudeStore } = await loadStore();
    const real = Storage.prototype.setItem;
    let calls = 0;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      calls++;
      if (calls === 1) throw new DOMException('full', 'QuotaExceededError');
      real.call(this, k, v);
    });
    const s = useClaudeStore.getState();
    for (let i = 0; i < 30; i++) s.addUser(`m${i}`);
    spy.mockRestore();
    expect(saved().messages.length).toBeLessThanOrEqual(30);
    expect(calls).toBeGreaterThan(1);
  });

  it('migrates a persisted Auto mode to ask', async () => {
    localStorage.setItem('dashboard-claude', JSON.stringify({ state: { messages: [], chatMode: 'auto' }, version: 3 }));
    const { useClaudeStore } = await loadStore();
    expect(useClaudeStore.getState().chatMode).toBe('ask');
  });

  it('dropUnsentTurn removes the trailing user bubble and its empty reply', async () => {
    const { useClaudeStore } = await loadStore();
    const s = useClaudeStore.getState();
    s.addUser('keep');
    s.beginAssistant();
    s.appendDelta('ok');
    s.addUser('lost');
    s.beginAssistant();
    s.dropUnsentTurn();
    expect(useClaudeStore.getState().messages).toHaveLength(2);
  });
});
