import { useState } from 'react';
import { Plus, Check, X } from 'lucide-react';
import { useTasksStore } from '../../store/tasksStore';
import { cn } from '../../lib/utils';

export function TasksWidget() {
  const { tasks, addTask, toggleTask, removeTask, clearCompleted } = useTasksStore();
  const [draft, setDraft] = useState('');
  const remaining = tasks.filter((t) => !t.done).length;
  const doneCount = tasks.length - remaining;

  function submit() {
    addTask(draft);
    setDraft('');
  }

  return (
    <div className="h-full flex flex-col p-2 gap-2">
      {/* Add */}
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Add a task…"
          className="flex-1 bg-th-elevated border border-th-line rounded-lg px-2.5 py-1.5 text-th-hi text-xs placeholder:text-th-ghost focus:outline-none focus:border-th-3 transition-colors"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="shrink-0 p-1.5 rounded-lg bg-th-overlay hover:bg-th-overlay/70 text-th-hi disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Add task"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5">
        {tasks.length === 0 ? (
          <div className="h-full flex items-center justify-center text-th-ghost text-xs">No tasks</div>
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-th-elevated/50">
              <button
                onClick={() => toggleTask(t.id)}
                className={cn(
                  'shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
                  t.done ? 'bg-th-accent border-th-accent text-th-bg' : 'border-th-ghost hover:border-th-2',
                )}
                title={t.done ? 'Mark not done' : 'Mark done'}
              >
                {t.done && <Check size={11} />}
              </button>
              <span className={cn('flex-1 text-xs break-words', t.done ? 'line-through text-th-ghost' : 'text-th-2')}>
                {t.text}
              </span>
              <button
                onClick={() => removeTask(t.id)}
                className="shrink-0 p-0.5 rounded text-th-ghost hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                title="Delete"
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {tasks.length > 0 && (
        <div className="shrink-0 flex items-center justify-between text-[10px] text-th-ghost px-1">
          <span>{remaining} left</span>
          {doneCount > 0 && (
            <button onClick={clearCompleted} className="hover:text-th-2 transition-colors">
              Clear completed
            </button>
          )}
        </div>
      )}
    </div>
  );
}
