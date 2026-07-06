import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';
import { collectActions, matchParamCommand, refreshSources } from '../lib/commandRegistry';
import type { PaletteAction, ParamCommandMatch } from '../lib/commandRegistry';
import { fuzzyScore } from '../lib/fuzzy';
import { useOverlayStore } from '../store/overlayStore';
import { cn } from '../lib/utils';

// In-app command palette (per scope: NOT a global shortcut).
// Open with mod+K or double-Shift (<300ms). Recents float on an empty query.

const RECENTS_KEY = 'dashboard-palette-recents';
const RECENTS_MAX = 8;
const DOUBLE_SHIFT_MS = 300;
const LIST_MAX = 40;

// Stable section order for the empty-query (browse) view. Unknown groups sink
// to the end, keeping their registration order.
const GROUP_ORDER = [
  'Recent', 'Command', 'Layouts', 'Widgets', 'Timers', 'Tasks & Notes',
  'Media', 'System', 'Appearance', 'Alerts', 'App',
];

function groupRank(group: string): number {
  const i = GROUP_ORDER.indexOf(group);
  return i === -1 ? GROUP_ORDER.length : i;
}

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): void {
  const next = [id, ...readRecents().filter((r) => r !== id)].slice(0, RECENTS_MAX);
  localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
}

/** Global open shortcuts — mounted once (inside CommandPalette). */
function useOpenShortcuts() {
  const setPaletteOpen = useOverlayStore((s) => s.setPaletteOpen);
  useEffect(() => {
    let lastShiftDown = 0;
    let shiftChordBroken = false;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = navigator.platform.toLowerCase().includes('mac') ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(!useOverlayStore.getState().paletteOpen);
        return;
      }
      if (e.key === 'Shift') {
        if (e.repeat) return;
        const now = performance.now();
        if (!shiftChordBroken && now - lastShiftDown < DOUBLE_SHIFT_MS) {
          lastShiftDown = 0;
          setPaletteOpen(true);
        } else {
          lastShiftDown = now;
          shiftChordBroken = false;
        }
      } else {
        // Any other key between the two Shifts (e.g. Shift+A typing) breaks the chord.
        shiftChordBroken = true;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPaletteOpen]);
}

// A list row: a plain action, or the pinned parameterized-command row (which
// renders its parse preview, or a non-executable grammar hint while args
// don't parse yet).
type PaletteRow =
  | { kind: 'action'; action: PaletteAction }
  | { kind: 'command'; match: ParamCommandMatch };

export function CommandPalette() {
  useOpenShortcuts();
  const open = useOverlayStore((s) => s.paletteOpen);
  const setOpen = useOverlayStore((s) => s.setPaletteOpen);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [actions, setActions] = useState<PaletteAction[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Snapshot actions + reset input on every open (sources reflect live state).
  // Launcher items live behind async IPC — re-collect once the snapshot lands.
  useEffect(() => {
    if (!open) return;
    setActions(collectActions());
    setQuery('');
    setSelected(0);
    void refreshSources().then(() => setActions(collectActions()));
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim();
    const rows: PaletteRow[] = [];

    // Parameterized command pinned at index 0 (raw query — trailing space
    // is what lets a unique trigger prefix match).
    const param = matchParamCommand(query);
    if (param) rows.push({ kind: 'command', match: param });

    let flat: PaletteAction[];
    if (!q) {
      // Empty query: recents first (in MRU order), then everything else grouped.
      const byId = new Map(actions.map((a) => [a.id, a]));
      const recents = readRecents().map((id) => byId.get(id)).filter((a): a is PaletteAction => !!a);
      const recentIds = new Set(recents.map((a) => a.id));
      const rest = actions
        .filter((a) => !recentIds.has(a.id))
        .sort((a, b) => groupRank(a.group) - groupRank(b.group));
      flat = [...recents.map((a) => ({ ...a, group: 'Recent' })), ...rest].slice(0, LIST_MAX);
    } else {
      flat = actions
        .map((a) => ({ a, score: fuzzyScore(q, `${a.title} ${a.keywords ?? ''}`) }))
        .filter((x) => x.score >= 0)
        .sort((x, y) => y.score - x.score)
        .map((x) => x.a)
        .slice(0, LIST_MAX);
    }
    rows.push(...flat.map((action): PaletteRow => ({ kind: 'action', action })));

    // Precompute section headers so the render pass stays pure.
    const groupOf = (r: PaletteRow) => (r.kind === 'command' ? 'Command' : r.action.group);
    return rows.map((row, i) => ({
      row,
      header: i === 0 || groupOf(rows[i - 1]) !== groupOf(row) ? groupOf(row) : null,
    }));
  }, [actions, query]);

  // A hint row (command whose args don't parse) is never selectable.
  const head = results[0];
  const firstSelectable = head && head.row.kind === 'command' && !head.row.match.parsed ? 1 : 0;

  useEffect(() => setSelected(firstSelectable), [query, firstSelectable]);

  // Keep the selected row scrolled into view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!open) return null;

  function moveSelection(delta: number) {
    setSelected((i) => {
      const max = results.length - 1;
      if (max < firstSelectable) return i; // nothing selectable
      return Math.min(Math.max(i + delta, firstSelectable), max);
    });
  }

  function runRow(row: PaletteRow) {
    if (row.kind === 'command') {
      if (!row.match.parsed) return; // grammar hint — nothing to run yet
      setOpen(false);
      pushRecent(row.match.cmd.id);
      row.match.parsed.run();
      return;
    }
    if (row.action.fill !== undefined) {
      // Discoverability row: prefill the input and keep the palette open.
      setQuery(row.action.fill);
      inputRef.current?.focus();
      return;
    }
    setOpen(false);
    pushRecent(row.action.id);
    row.action.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    if (e.key === 'Enter' && results[selected]) { e.preventDefault(); runRow(results[selected].row); }
  }

  return (
    <div
      className="fixed inset-0 z-[400] flex items-start justify-center pt-[14vh] bg-black/50"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-[520px] max-w-[90vw] bg-th-surface border border-th-line rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[60vh]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-th-line shrink-0">
          <Search size={14} className="text-th-ghost shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            autoFocus
            spellCheck={false}
            className="flex-1 bg-transparent text-th-hi text-sm placeholder:text-th-ghost focus:outline-none"
          />
          <kbd className="text-th-ghost text-[10px] border border-th-line rounded px-1.5 py-0.5 shrink-0">esc</kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="text-th-ghost text-xs text-center py-6">No matching commands</p>
          )}
          {results.map(({ row, header }, i) => {
            const isHint = row.kind === 'command' && !row.match.parsed;
            const title = row.kind === 'command'
              ? row.match.parsed?.preview ?? `${row.match.cmd.triggers[0]} ${row.match.cmd.argHint}`
              : row.action.title;
            const key = row.kind === 'command' ? `command:${row.match.cmd.id}` : row.action.id;
            return (
              <div key={key}>
                {header && (
                  <p className="px-4 pt-2 pb-1 text-th-ghost text-[10px] uppercase tracking-widest">{header}</p>
                )}
                <button
                  data-idx={i}
                  onClick={() => runRow(row)}
                  onMouseMove={() => { if (!isHint) setSelected(i); }}
                  className={cn(
                    'w-full flex items-center gap-2 px-4 py-1.5 text-left text-xs transition-colors',
                    isHint
                      ? 'text-th-ghost cursor-default'
                      : i === selected ? 'bg-th-elevated text-th-hi' : 'text-th-2',
                  )}
                >
                  <span className="flex-1 min-w-0 truncate">{title}</span>
                  {!isHint && i === selected && <CornerDownLeft size={11} className="text-th-ghost shrink-0" />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-th-line text-th-ghost text-[10px] shrink-0">
          ↑↓ navigate · Enter run · type &quot;timer 25m&quot;, &quot;task …&quot;, &quot;volume 40&quot;
        </div>
      </div>
    </div>
  );
}
