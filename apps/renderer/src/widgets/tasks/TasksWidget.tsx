import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTasksStore } from '../../store/tasksStore';
import { Button, Checkbox, EmptyState, IconButton, cn } from '@nish/ui';
import { Input } from '../../components/nishGaps';

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
        <Input
          size="xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Add a task…"
          aria-label="New task"
          className="flex-1"
        />
        <IconButton label="Add task" size="sm" variant="subtle" onClick={submit} disabled={!draft.trim()}>
          <Plus size={14} />
        </IconButton>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5">
        {tasks.length === 0 ? (
          <EmptyState compact title="No tasks" />
        ) : (
          tasks.map((t) => (
            <div key={t.id} className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-th-elevated">
              <Checkbox
                size="sm"
                checked={t.done}
                onChange={() => toggleTask(t.id)}
                aria-label={t.done ? `Mark "${t.text}" not done` : `Mark "${t.text}" done`}
                title={t.done ? 'Mark not done' : 'Mark done'}
              />
              <span className={cn('flex-1 text-xs break-words', t.done ? 'line-through text-th-hi3' : 'text-th-hi2')}>
                {t.text}
              </span>
              <IconButton
                label="Delete"
                size="xs"
                tone="danger"
                onClick={() => removeTask(t.id)}
                className="size-5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
              >
                <X size={12} />
              </IconButton>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {tasks.length > 0 && (
        <div className="shrink-0 flex items-center justify-between text-3xs text-th-hi3 px-1">
          <span>{remaining} left</span>
          {doneCount > 0 && (
            <Button variant="link" size="xs" onClick={clearCompleted} className="text-th-hi3 hover:text-th-hi2">
              Clear completed
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
