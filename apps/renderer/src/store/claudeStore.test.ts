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
