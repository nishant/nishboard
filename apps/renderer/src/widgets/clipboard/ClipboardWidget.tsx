import { useCallback, useEffect, useState } from 'react';
import { Clipboard, Search, Pause, Play, Trash2, X } from 'lucide-react';
import { useClipboardUiStore } from '../../store/clipboardUiStore';
import { HeaderAction } from '../../components/HeaderAction';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../lib/alerts';
import { relTimeAgo } from '../../lib/time';
import type { ClipboardEntryData } from '@dash/shared';

/** WidgetShell header actions: pause/resume capture + clear history. */
export function ClipboardActions() {
  const paused = useClipboardUiStore((s) => s.paused);
  const togglePaused = useClipboardUiStore((s) => s.togglePaused);
  return (
    <>
      <HeaderAction title={paused ? 'Resume capture' : 'Pause capture'} active={paused} onClick={togglePaused}>
        {paused ? <Play size={11} /> : <Pause size={11} />}
      </HeaderAction>
      <HeaderAction
        title="Clear history"
        danger
        onClick={() => void window.electron?.clipboardHistory?.clear()}
      >
        <Trash2 size={11} />
      </HeaderAction>
    </>
  );
}

export function ClipboardWidget() {
  const paused = useClipboardUiStore((s) => s.paused);
  const [entries, setEntries] = useState<ClipboardEntryData[]>([]);
  const [query, setQuery] = useState('');
  const inElectron = typeof window !== 'undefined' && !!window.electron?.clipboardHistory;

  const refresh = useCallback(async () => {
    const next = await window.electron?.clipboardHistory?.getHistory?.();
    if (next) setEntries(next);
  }, []);

  // Gate the main-process poller: it runs only while this widget is mounted
  // AND not paused. Unmount (widget hidden / app layout change) stops capture.
  useEffect(() => {
    if (!inElectron) return;
    void window.electron?.clipboardHistory?.setEnabled(!paused);
    return () => {
      void window.electron?.clipboardHistory?.setEnabled(false);
    };
  }, [paused, inElectron]);

  useEffect(() => {
    if (!inElectron) return;
    void refresh();
    return window.electron?.clipboardHistory?.onChanged(() => void refresh());
  }, [refresh, inElectron]);

  async function copyEntry(entry: ClipboardEntryData) {
    await window.electron?.clipboardHistory?.copy(entry.id);
    toast('Copied to clipboard', undefined, 'success');
  }

  if (!inElectron) {
    return <EmptyState icon={<Clipboard size={16} />} message="Clipboard history works in the desktop app" />;
  }

  const q = query.trim().toLowerCase();
  const filtered = q ? entries.filter((e) => e.text.toLowerCase().includes(q)) : entries;

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-th-line shrink-0">
        <Search size={11} className="text-th-ghost shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter history…"
          className="flex-1 min-w-0 bg-transparent text-th-hi text-xs placeholder:text-th-ghost focus:outline-none"
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-th-ghost hover:text-th-2 transition-colors shrink-0">
            <X size={11} />
          </button>
        )}
        {paused && <span className="text-amber-400 text-[10px] shrink-0">paused</span>}
      </div>

      {/* Entries */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState
            icon={<Clipboard size={16} />}
            message={paused ? 'Capture paused' : 'Copy something — it shows up here (in-memory only)'}
          />
        ) : filtered.length === 0 ? (
          <EmptyState message="No matches" />
        ) : (
          filtered.map((entry) => (
            <button
              key={entry.id}
              onClick={() => void copyEntry(entry)}
              className="w-full text-left px-3 py-2 hover:bg-th-elevated/60 transition-colors border-b border-th-line/40"
              title="Click to copy"
            >
              <p className="text-th-2 text-[11px] leading-snug line-clamp-2 break-all whitespace-pre-wrap">
                {entry.text}
              </p>
              <p className="text-th-ghost text-[10px] mt-0.5">{relTimeAgo(new Date(entry.at).toISOString())}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
