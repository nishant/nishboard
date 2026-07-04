import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Globe, AppWindow, Pencil, Plus, X, ArrowUp, ArrowDown, Rocket } from 'lucide-react';
import { useLauncherUiStore } from '../../store/launcherUiStore';
import { HeaderAction } from '../../components/HeaderAction';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../lib/alerts';
import type { LauncherItemData } from '@dash/shared';

/** Items live main-side; this hook mirrors them into renderer state. */
function useLauncherItems() {
  const [items, setItems] = useState<LauncherItemData[]>([]);
  const refresh = useCallback(async () => {
    const next = await window.electron?.launcher?.getItems?.();
    if (next) setItems(next);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { items, refresh };
}

function ItemIcon({ kind, size = 14 }: { kind: LauncherItemData['kind']; size?: number }) {
  return kind === 'url' ? <Globe size={size} /> : <AppWindow size={size} />;
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({
  items, refresh, onClose,
}: {
  items: LauncherItemData[];
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [urlLabel, setUrlLabel] = useState('');
  const [url, setUrl] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const launcher = window.electron?.launcher;

  async function addApp() {
    const added = await launcher?.addApp();
    if (added) await refresh();
  }

  async function addUrl() {
    if (!/^https?:\/\//i.test(url.trim())) {
      toast('Invalid URL', 'Only http(s) links are supported', 'error');
      return;
    }
    await launcher?.addUrl(urlLabel, url.trim());
    setUrlLabel('');
    setUrl('');
    await refresh();
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = items.findIndex((it) => it.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= items.length) return;
    const ids = items.map((it) => it.id);
    [ids[idx], ids[to]] = [ids[to], ids[idx]];
    await launcher?.reorder(ids);
    await refresh();
  }

  async function commitRename(id: string) {
    await launcher?.renameItem(id, renameText);
    setRenamingId(null);
    await refresh();
  }

  function onUrlKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void addUrl();
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 rounded-lg">
      <div className="bg-th-surface border border-th-line rounded-xl p-4 w-80 max-h-[85%] flex flex-col gap-3 shadow-xl">
        <div className="flex items-center justify-between">
          <span className="text-th-hi font-semibold text-sm">Edit Launcher</span>
          <button onClick={onClose} className="text-th-3 hover:text-th-hi transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
          {items.length === 0 && (
            <p className="text-th-ghost text-xs text-center py-3">No shortcuts yet</p>
          )}
          {items.map((it, i) => (
            <div key={it.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-th-elevated group">
              <span className="text-th-3 shrink-0"><ItemIcon kind={it.kind} size={12} /></span>
              {renamingId === it.id ? (
                <input
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => void commitRename(it.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename(it.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  autoFocus
                  className="flex-1 min-w-0 bg-transparent text-th-hi text-xs focus:outline-none border-b border-th-3"
                />
              ) : (
                <span
                  className="flex-1 min-w-0 truncate text-th-hi text-xs cursor-text"
                  onDoubleClick={() => { setRenamingId(it.id); setRenameText(it.label); }}
                  title="Double-click to rename"
                >
                  {it.label}
                </span>
              )}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button onClick={() => void move(it.id, -1)} disabled={i === 0} className="p-0.5 text-th-ghost hover:text-th-2 disabled:opacity-30" title="Move up"><ArrowUp size={11} /></button>
                <button onClick={() => void move(it.id, 1)} disabled={i === items.length - 1} className="p-0.5 text-th-ghost hover:text-th-2 disabled:opacity-30" title="Move down"><ArrowDown size={11} /></button>
                <button
                  onClick={async () => { await launcher?.removeItem(it.id); await refresh(); }}
                  className="p-0.5 text-th-ghost hover:text-red-400"
                  title="Remove"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-th-line pt-3">
          <button
            onClick={() => void addApp()}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
          >
            <AppWindow size={13} /> Add app…
          </button>
          <div className="flex gap-1.5">
            <input
              value={urlLabel}
              onChange={(e) => setUrlLabel(e.target.value)}
              onKeyDown={onUrlKey}
              placeholder="Label"
              className="w-20 bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[11px] placeholder:text-th-ghost focus:outline-none focus:border-th-3"
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={onUrlKey}
              placeholder="https://…"
              className="flex-1 min-w-0 bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[11px] font-mono placeholder:text-th-ghost focus:outline-none focus:border-th-3"
            />
            <button
              onClick={() => void addUrl()}
              disabled={!url.trim()}
              className="shrink-0 px-2 rounded-lg bg-th-overlay hover:bg-th-overlay/70 text-th-hi disabled:opacity-40 transition-colors"
              title="Add link"
            >
              <Plus size={13} />
            </button>
          </div>
          <p className="text-th-ghost text-[10px] leading-relaxed">
            App paths stay in the main process — the dashboard launches by id.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Widget ────────────────────────────────────────────────────────────────────

/** WidgetShell header actions: edit pencil. */
export function LauncherActions() {
  const setEditing = useLauncherUiStore((s) => s.setEditing);
  return (
    <HeaderAction title="Edit shortcuts" onClick={() => setEditing(true)}>
      <Pencil size={11} />
    </HeaderAction>
  );
}

export function LauncherWidget() {
  const { items, refresh } = useLauncherItems();
  const { editing, setEditing } = useLauncherUiStore();
  const inElectron = typeof window !== 'undefined' && !!window.electron;

  return (
    <div className="relative h-full overflow-hidden">
      {editing && <EditModal items={items} refresh={refresh} onClose={() => setEditing(false)} />}

      {!inElectron ? (
        <EmptyState icon={<Rocket size={16} />} message="Launcher works in the desktop app" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Rocket size={16} />} message="No shortcuts — add some with the pencil" />
      ) : (
        <div className="h-full overflow-y-auto p-2 grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] auto-rows-min gap-1.5">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => void window.electron?.launcher?.launch(it.id)}
              className="flex flex-col items-center gap-1.5 px-1 py-2.5 rounded-lg hover:bg-th-elevated/70 text-th-2 hover:text-th-hi transition-colors"
              title={it.label}
            >
              <ItemIcon kind={it.kind} size={18} />
              <span className="text-[10px] leading-tight truncate max-w-full">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
