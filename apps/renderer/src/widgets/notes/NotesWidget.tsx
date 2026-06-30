import { Eye, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useNotesStore } from '../../store/notesStore';

export function NotesWidget() {
  const { text, rendered, setText, setRendered } = useNotesStore();

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-end px-2 pt-2 shrink-0">
        <button
          onClick={() => setRendered(!rendered)}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-th-ghost hover:text-th-2 hover:bg-th-elevated/60 transition-colors"
          title={rendered ? 'Edit' : 'Preview'}
        >
          {rendered ? <><Pencil size={11} /> Edit</> : <><Eye size={11} /> Preview</>}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 px-2 pb-2">
        {rendered ? (
          <div className="md-render h-full overflow-y-auto text-th-2 text-xs leading-relaxed">
            {text.trim()
              ? <ReactMarkdown>{text}</ReactMarkdown>
              : <span className="text-th-ghost">Nothing to preview</span>}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Jot something… markdown supported"
            spellCheck={false}
            className="w-full h-full resize-none bg-transparent text-th-2 text-xs leading-relaxed placeholder:text-th-ghost focus:outline-none"
          />
        )}
      </div>
    </div>
  );
}
