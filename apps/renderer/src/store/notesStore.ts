import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NotesState {
  text: string;
  rendered: boolean; // false = edit (textarea), true = rendered markdown preview
  setText: (text: string) => void;
  setRendered: (rendered: boolean) => void;
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      text: '',
      rendered: false,
      setText: (text) => set({ text }),
      setRendered: (rendered) => set({ rendered }),
    }),
    { name: 'dashboard-notes' },
  ),
);
