import { useEffect, useRef, useState } from 'react';
import { Eye, Pencil, Plus, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNotesStore } from '../../store/notesStore';

// Module-level so the plugin array stays referentially stable across renders.
const MD_PLUGINS = [remarkGfm];
import { cn } from '../../lib/utils';

/** Inline rename input — mounted in place of the tab label while renaming. */
function RenameInput({ initial, onCommit }: { initial: string; onCommit: (title: string) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => ref.current?.select(), []);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(value);
        if (e.key === 'Escape') onCommit(initial);
      }}
      onClick={(e) => e.stopPropagation()}
      spellCheck={false}
      className="w-20 bg-transparent text-th-hi text-[10px] focus:outline-none border-b border-th-3"
    />
  );
}

export function NotesWidget() {
  const { notes, activeId, rendered, setContent, setRendered, setActive, addNote, renameNote, removeNote } =
    useNotesStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Two-step delete: first click arms, second within the timeout deletes.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmingId) return;
    const id = setTimeout(() => setConfirmingId(null), 2500);
    return () => clearTimeout(id);
  }, [confirmingId]);

  const active = notes.find((n) => n.id === activeId) ?? notes[0];

  return (
    <div className="h-full flex flex-col">
      {/* Tab strip + preview toggle */}
      <div className="flex items-center gap-1 px-2 pt-2 shrink-0">
        <div className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
          {notes.map((n) => {
            const isActive = n.id === active.id;
            return (
              <div
                key={n.id}
                onClick={() => setActive(n.id)}
                onDoubleClick={() => setRenamingId(n.id)}
                className={cn(
                  'group/tab flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-[10px] cursor-pointer select-none shrink-0 transition-colors',
                  isActive ? 'bg-th-elevated text-th-hi' : 'text-th-ghost hover:text-th-2 hover:bg-th-elevated/50',
                )}
                title={isActive ? 'Double-click to rename' : n.title}
              >
                {renamingId === n.id ? (
                  <RenameInput
                    initial={n.title}
                    onCommit={(title) => { renameNote(n.id, title); setRenamingId(null); }}
                  />
                ) : (
                  <span className="max-w-24 truncate">{n.title}</span>
                )}
                {isActive && renamingId !== n.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmingId === n.id) { removeNote(n.id); setConfirmingId(null); }
                      else setConfirmingId(n.id);
                    }}
                    className={cn(
                      'p-0.5 rounded transition-colors',
                      confirmingId === n.id
                        ? 'text-red-400 bg-red-500/15'
                        : 'text-th-ghost hover:text-red-400',
                    )}
                    title={confirmingId === n.id ? 'Click again to delete' : 'Delete note'}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            onClick={addNote}
            className="p-1 rounded text-th-ghost hover:text-th-2 hover:bg-th-elevated/60 transition-colors shrink-0"
            title="New note"
          >
            <Plus size={11} />
          </button>
        </div>

        <button
          onClick={() => setRendered(!rendered)}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-th-ghost hover:text-th-2 hover:bg-th-elevated/60 transition-colors shrink-0"
          title={rendered ? 'Edit' : 'Preview'}
        >
          {rendered ? <><Pencil size={11} /> Edit</> : <><Eye size={11} /> Preview</>}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 px-2 pb-2 pt-1.5">
        {rendered ? (
          <div className="md-render h-full overflow-y-auto text-th-2 text-xs leading-relaxed">
            {active.content.trim()
              ? <ReactMarkdown remarkPlugins={MD_PLUGINS}>{active.content}</ReactMarkdown>
              : <span className="text-th-ghost">Nothing to preview</span>}
          </div>
        ) : (
          <textarea
            // Remount per note so undo history/selection don't leak across tabs
            key={active.id}
            value={active.content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Jot something… markdown supported"
            spellCheck={false}
            className="w-full h-full resize-none bg-transparent text-th-2 text-xs leading-relaxed placeholder:text-th-ghost focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
