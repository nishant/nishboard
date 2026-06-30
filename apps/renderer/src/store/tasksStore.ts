import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Task {
  id: string;
  text: string;
  done: boolean;
}

interface TasksState {
  tasks: Task[];
  addTask: (text: string) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  clearCompleted: () => void;
}

export const useTasksStore = create<TasksState>()(
  persist(
    (set) => ({
      tasks: [],
      addTask: (text) =>
        set((s) => {
          const t = text.trim();
          if (!t) return s;
          return { tasks: [...s.tasks, { id: crypto.randomUUID(), text: t, done: false }] };
        }),
      toggleTask: (id) =>
        set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
      removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      clearCompleted: () => set((s) => ({ tasks: s.tasks.filter((t) => !t.done) })),
    }),
    { name: 'dashboard-tasks' },
  ),
);
