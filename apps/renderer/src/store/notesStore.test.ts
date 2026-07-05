import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadStore() {
  const mod = await import('./notesStore');
  return mod.useNotesStore;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe('dashboard-notes v0 → v1 migration', () => {
  it('turns the single scratchpad into one note, keeping its text', async () => {
    localStorage.setItem('dashboard-notes', JSON.stringify({ state: { text: 'groceries', rendered: true }, version: 0 }));
    const store = await loadStore();
    const s = store.getState();
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].content).toBe('groceries');
    expect(s.activeId).toBe(s.notes[0].id);
    expect(s.rendered).toBe(true);
  });

  it('passes a v1 notes array through and drops the legacy text field', async () => {
    localStorage.setItem(
      'dashboard-notes',
      JSON.stringify({ state: { notes: [{ id: 'n1', title: 'A', content: 'aa' }], activeId: 'n1', rendered: false, text: 'stale' }, version: 0 }),
    );
    const store = await loadStore();
    const s = store.getState();
    expect(s.notes).toEqual([{ id: 'n1', title: 'A', content: 'aa' }]);
    expect('text' in s).toBe(false);
  });
});

describe('note CRUD', () => {
  it('addNote activates the new note; setContent edits only the active one', async () => {
    const store = await loadStore();
    const firstId = store.getState().activeId;
    store.getState().addNote();
    const s = store.getState();
    expect(s.notes).toHaveLength(2);
    expect(s.activeId).not.toBe(firstId);
    store.getState().setContent('hello');
    expect(store.getState().notes.find((n) => n.id === s.activeId)?.content).toBe('hello');
    expect(store.getState().notes.find((n) => n.id === firstId)?.content).toBe('');
  });

  it('removing the last note resets to a fresh empty one', async () => {
    const store = await loadStore();
    const id = store.getState().activeId;
    store.getState().setContent('bye');
    store.getState().removeNote(id);
    const s = store.getState();
    expect(s.notes).toHaveLength(1);
    expect(s.notes[0].id).not.toBe(id);
    expect(s.notes[0].content).toBe('');
    expect(s.activeId).toBe(s.notes[0].id);
  });

  it('renameNote trims and falls back to Untitled', async () => {
    const store = await loadStore();
    const id = store.getState().activeId;
    store.getState().renameNote(id, '  Plans  ');
    expect(store.getState().notes[0].title).toBe('Plans');
    store.getState().renameNote(id, '   ');
    expect(store.getState().notes[0].title).toBe('Untitled');
  });
});
