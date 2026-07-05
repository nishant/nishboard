import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import {
  Globe, AppWindow, Pencil, Plus, X, ArrowUp, ArrowDown, Rocket,
  ChevronDown, ChevronRight, Play, RefreshCw, FolderPlus,
} from 'lucide-react';
import { useLauncherUiStore } from '../../store/launcherUiStore';
import { HeaderAction } from '../../components/HeaderAction';
import { EmptyState } from '../../components/EmptyState';
import { toast } from '../../lib/alerts';
import { cn } from '../../lib/utils';
import type { LauncherGroupData, LauncherItemData, LauncherStateData } from '@dash/shared';

const EMPTY_STATE: LauncherStateData = { groups: [], items: [] };

/** Items/groups live main-side; this hook mirrors them into renderer state. */
function useLauncherState() {
  const [state, setState] = useState<LauncherStateData>(EMPTY_STATE);
  const refresh = useCallback(async () => {
    const next = await window.electron?.launcher?.getItems?.();
    if (next) setState(next);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { ...state, refresh };
}

/** data:-URI icon resolved main-side, falling back to a kind glyph. */
function ItemIcon({ item, size = 14 }: { item: Pick<LauncherItemData, 'kind' | 'icon'>; size?: number }) {
  if (item.icon) {
    return (
      <img
        src={item.icon}
        alt=""
        draggable={false}
        style={{ width: size, height: size }}
        className="rounded-sm shrink-0"
      />
    );
  }
  return item.kind === 'url' ? <Globe size={size} /> : <AppWindow size={size} />;
}

// ── Edit modal ────────────────────────────────────────────────────────────────

function EditModal({
  groups, items, refresh, onClose,
}: {
  groups: LauncherGroupData[];
  items: LauncherItemData[];
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [urlLabel, setUrlLabel] = useState('');
  const [url, setUrl] = useState('');
  const [groupLabel, setGroupLabel] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [refreshingIcons, setRefreshingIcons] = useState(false);

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

  async function addGroup() {
    if (!groupLabel.trim()) return;
    await launcher?.addGroup(groupLabel.trim());
    setGroupLabel('');
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

  // Shared by item and group rows: renamingId holds either kind of id.
  async function commitRename(id: string, isGroup: boolean) {
    if (isGroup) await launcher?.renameGroup(id, renameText);
    else await launcher?.renameItem(id, renameText);
    setRenamingId(null);
    await refresh();
  }

  async function refreshIcons() {
    setRefreshingIcons(true);
    try {
      await launcher?.refreshIcons();
      await refresh();
    } finally {
      setRefreshingIcons(false);
    }
  }

  function onUrlKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') void addUrl();
    if (e.key === 'Escape') onClose();
  }

  const renameInput = (id: string, isGroup: boolean) => (
    <input
      value={renameText}
      onChange={(e) => setRenameText(e.target.value)}
      onBlur={() => void commitRename(id, isGroup)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commitRename(id, isGroup);
        if (e.key === 'Escape') setRenamingId(null);
      }}
      autoFocus
      className="flex-1 min-w-0 bg-transparent text-th-hi text-xs focus:outline-none border-b border-th-3"
    />
  );

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60 rounded-lg">
      <div className="bg-th-surface border border-th-line rounded-xl p-4 w-[22rem] max-h-[85%] flex flex-col gap-3 shadow-xl">
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
              <span className="text-th-3 shrink-0"><ItemIcon item={it} size={12} /></span>
              {renamingId === it.id ? (
                renameInput(it.id, false)
              ) : (
                <span
                  className="flex-1 min-w-0 truncate text-th-hi text-xs cursor-text"
                  onDoubleClick={() => { setRenamingId(it.id); setRenameText(it.label); }}
                  title="Double-click to rename"
                >
                  {it.label}
                </span>
              )}
              <select
                value={it.group ?? ''}
                onChange={async (e) => {
                  await launcher?.assignGroup(it.id, e.target.value || null);
                  await refresh();
                }}
                className="shrink-0 max-w-[6.5rem] bg-th-surface border border-th-line rounded px-1 py-0.5 text-th-2 text-[10px] focus:outline-none focus:border-th-3"
                title="Group"
              >
                <option value="">— none —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
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

          {groups.length > 0 && (
            <>
              <p className="text-th-ghost text-[10px] uppercase tracking-wider mt-2 mb-0.5">Groups</p>
              {groups.map((g) => (
                <div key={g.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-th-elevated group">
                  {renamingId === g.id ? (
                    renameInput(g.id, true)
                  ) : (
                    <span
                      className="flex-1 min-w-0 truncate text-th-hi text-xs cursor-text"
                      onDoubleClick={() => { setRenamingId(g.id); setRenameText(g.label); }}
                      title="Double-click to rename"
                    >
                      {g.label}
                    </span>
                  )}
                  <span className="text-th-ghost text-[10px] shrink-0">
                    {items.filter((it) => it.group === g.id).length} items
                  </span>
                  <button
                    onClick={async () => { await launcher?.removeGroup(g.id); await refresh(); }}
                    className="p-0.5 text-th-ghost hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Delete group (items are kept)"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </>
          )}
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
          <div className="flex gap-1.5">
            <input
              value={groupLabel}
              onChange={(e) => setGroupLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addGroup(); if (e.key === 'Escape') onClose(); }}
              placeholder="New group…"
              className="flex-1 min-w-0 bg-th-elevated border border-th-line rounded-lg px-2 py-1.5 text-th-hi text-[11px] placeholder:text-th-ghost focus:outline-none focus:border-th-3"
            />
            <button
              onClick={() => void addGroup()}
              disabled={!groupLabel.trim()}
              className="shrink-0 px-2 rounded-lg bg-th-overlay hover:bg-th-overlay/70 text-th-hi disabled:opacity-40 transition-colors"
              title="Add group"
            >
              <FolderPlus size={13} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-th-ghost text-[10px] leading-relaxed">
              App paths stay in the main process — the dashboard launches by id.
            </p>
            <button
              onClick={() => void refreshIcons()}
              disabled={refreshingIcons}
              className="shrink-0 flex items-center gap-1 text-th-ghost hover:text-th-2 text-[10px] disabled:opacity-50 transition-colors"
              title="Re-fetch app icons and favicons"
            >
              <RefreshCw size={10} className={cn(refreshingIcons && 'animate-spin')} /> Icons
            </button>
          </div>
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

function ItemGrid({ items }: { items: LauncherItemData[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(72px,1fr))] auto-rows-min gap-1.5">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => void window.electron?.launcher?.launch(it.id)}
          className="flex flex-col items-center gap-1.5 px-1 py-2.5 rounded-lg hover:bg-th-elevated/70 text-th-2 hover:text-th-hi transition-colors"
          title={it.label}
        >
          <ItemIcon item={it} size={18} />
          <span className="text-[10px] leading-tight truncate max-w-full">{it.label}</span>
        </button>
      ))}
    </div>
  );
}

export function LauncherWidget() {
  const { groups, items, refresh } = useLauncherState();
  const { editing, setEditing, collapsed, toggleCollapsed } = useLauncherUiStore();
  const inElectron = typeof window !== 'undefined' && !!window.electron;

  const ungrouped = items.filter((it) => !it.group);

  return (
    <div className="relative h-full overflow-hidden">
      {editing && (
        <EditModal groups={groups} items={items} refresh={refresh} onClose={() => setEditing(false)} />
      )}

      {!inElectron ? (
        <EmptyState icon={<Rocket size={16} />} message="Launcher works in the desktop app" />
      ) : items.length === 0 ? (
        <EmptyState icon={<Rocket size={16} />} message="No shortcuts — add some with the pencil" />
      ) : (
        <div className="h-full overflow-y-auto p-2 flex flex-col gap-1.5">
          {ungrouped.length > 0 && <ItemGrid items={ungrouped} />}
          {groups.map((g) => {
            const members = items.filter((it) => it.group === g.id);
            if (members.length === 0) return null;
            const isCollapsed = !!collapsed[g.id];
            return (
              <div key={g.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-1 group/hdr">
                  <button
                    onClick={() => toggleCollapsed(g.id)}
                    className="flex items-center gap-1 text-th-ghost hover:text-th-2 text-[10px] uppercase tracking-wider transition-colors min-w-0"
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                  >
                    {isCollapsed ? <ChevronRight size={11} className="shrink-0" /> : <ChevronDown size={11} className="shrink-0" />}
                    <span className="truncate">{g.label}</span>
                    <span className="tabular-nums">({members.length})</span>
                  </button>
                  <button
                    onClick={() => void window.electron?.launcher?.launchGroup(g.id)}
                    className="p-0.5 text-th-ghost hover:text-th-hi opacity-0 group-hover/hdr:opacity-100 transition-all shrink-0"
                    title={`Launch all in ${g.label}`}
                  >
                    <Play size={11} />
                  </button>
                </div>
                {!isCollapsed && <ItemGrid items={members} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
