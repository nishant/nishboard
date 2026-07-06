import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Note {
  id: string;
  title: string;
  content: string;
}

function newNote(title = 'Untitled', content = ''): Note {
  return { id: crypto.randomUUID(), title, content };
}

interface NotesState {
  notes: Note[];
  activeId: string;
  rendered: boolean; // false = edit (textarea), true = rendered markdown preview
  setContent: (content: string) => void;
  setRendered: (rendered: boolean) => void;
  setActive: (id: string) => void;
  addNote: () => void;
  /** One-shot create (command palette): content = text, title from the first
   *  ~30 chars (word-boundary truncated), activated immediately. */
  addNoteWithText: (text: string) => void;
  renameNote: (id: string, title: string) => void;
  /** Deleting the last remaining note resets it to a fresh empty one. */
  removeNote: (id: string) => void;
}

const initial = newNote('Notes');

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      notes: [initial],
      activeId: initial.id,
      rendered: false,

      setContent: (content) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === s.activeId ? { ...n, content } : n)),
        })),
      setRendered: (rendered) => set({ rendered }),
      setActive: (activeId) => set({ activeId }),
      addNote: () =>
        set((s) => {
          const note = newNote();
          return { notes: [...s.notes, note], activeId: note.id };
        }),
      addNoteWithText: (text) =>
        set((s) => {
          const content = text.trim();
          let title = content.split('\n')[0];
          if (title.length > 30) {
            const cut = title.slice(0, 30);
            const space = cut.lastIndexOf(' ');
            title = `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
          }
          const note = newNote(title || 'Untitled', content);
          return { notes: [...s.notes, note], activeId: note.id };
        }),
      renameNote: (id, title) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, title: title.trim() || 'Untitled' } : n)),
        })),
      removeNote: (id) =>
        set((s) => {
          const remaining = s.notes.filter((n) => n.id !== id);
          if (remaining.length === 0) {
            const fresh = newNote('Notes');
            return { notes: [fresh], activeId: fresh.id };
          }
          return {
            notes: remaining,
            activeId: s.activeId === id ? remaining[0].id : s.activeId,
          };
        }),
    }),
    {
      name: 'dashboard-notes',
      version: 1,
      // v0 was a single scratchpad: { text, rendered } → one migrated note.
      migrate: (persisted) => {
        const old = persisted as Partial<NotesState> & { text?: string };
        if (!Array.isArray(old.notes) || old.notes.length === 0) {
          const first = newNote('Notes', old.text ?? '');
          return { notes: [first], activeId: first.id, rendered: old.rendered ?? false };
        }
        delete old.text;
        return old;
      },
    },
  ),
);
