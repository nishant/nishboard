import { useEffect, useRef, useState } from 'react';
import { Eye, Pencil, Plus, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNotesStore } from '../../store/notesStore';
import { Button, IconButton, cn } from '@nish/ui';

// Module-level so the plugin array stays referentially stable across renders.
const MD_PLUGINS = [remarkGfm];

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
      className="w-20 bg-transparent text-th-hi text-3xs focus:outline-none border-b border-th-hi3"
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
        <div role="tablist" aria-label="Notes" className="flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
          {notes.map((n) => {
            const isActive = n.id === active.id;
            return (
              <div
                key={n.id}
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActive(n.id)}
                onDoubleClick={() => setRenamingId(n.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'F2' || (e.key === 'Enter' && isActive)) { e.preventDefault(); setRenamingId(n.id); }
                  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(n.id); }
                }}
                className={cn(
                  'group/tab flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md text-3xs cursor-pointer select-none shrink-0 transition-colors',
                  isActive ? 'bg-th-elevated text-th-hi' : 'text-th-hi3 hover:text-th-hi2 hover:bg-th-elevated',
                )}
                title={isActive ? 'Double-click (or F2) to rename' : n.title}
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
                  <IconButton
                    label={confirmingId === n.id ? 'Click again to delete' : 'Delete note'}
                    size="xs"
                    tone="danger"
                    active={confirmingId === n.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirmingId === n.id) { removeNote(n.id); setConfirmingId(null); }
                      else setConfirmingId(n.id);
                    }}
                    className="size-4 rounded"
                  >
                    <X size={10} />
                  </IconButton>
                )}
              </div>
            );
          })}
          <IconButton label="New note" size="xs" onClick={addNote}>
            <Plus size={11} />
          </IconButton>
        </div>

        <Button
          variant="ghost"
          size="xs"
          onClick={() => setRendered(!rendered)}
          icon={rendered ? <Pencil size={11} /> : <Eye size={11} />}
          className="text-th-hi3"
        >
          {rendered ? 'Edit' : 'Preview'}
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 px-2 pb-2 pt-1.5">
        {rendered ? (
          <div className="md-render h-full overflow-y-auto text-th-hi2 text-xs leading-relaxed">
            {active.content.trim()
              ? <ReactMarkdown remarkPlugins={MD_PLUGINS}>{active.content}</ReactMarkdown>
              : <span className="text-th-hi3">Nothing to preview</span>}
          </div>
        ) : (
          <textarea
            // Remount per note so undo history/selection don't leak across tabs
            key={active.id}
            aria-label={`${active.title} note`}
            value={active.content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Jot something… markdown supported"
            spellCheck={false}
            className="w-full h-full resize-none bg-transparent text-th-hi2 text-xs leading-relaxed placeholder:text-th-ghost focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
