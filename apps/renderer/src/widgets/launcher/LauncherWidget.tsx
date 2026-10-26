import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import {
  Globe, AppWindow, Pencil, Plus, X, ArrowUp, ArrowDown, Rocket,
  ChevronDown, ChevronRight, Play, RefreshCw, FolderPlus,
} from 'lucide-react';
import { useLauncherUiStore } from '../../store/launcherUiStore';
import { HeaderAction } from '../../components/HeaderAction';
import { toast } from '../../lib/alerts';
import type { LauncherGroupData, LauncherItemData, LauncherStateData } from '@dash/shared';
import { Button, Card, EmptyState, IconButton, Modal, Label, Input, Select } from '@nish/ui';

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
      className="flex-1 min-w-0 bg-transparent text-th-hi text-xs focus:outline-none border-b border-th-hi3"
    />
  );

  return (
    <Modal title="Edit Launcher" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          {items.length === 0 && (
            <p className="text-th-hi3 text-xs text-center py-3">No shortcuts yet</p>
          )}
          {items.map((it, i) => (
            <Card key={it.id} variant="inset" padding="none" className="flex items-center gap-2 px-2.5 py-1 group">
              <span className="text-th-hi3 shrink-0"><ItemIcon item={it} size={12} /></span>
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
              <Select
                size="xs"
                value={it.group ?? ''}
                onChange={async (e) => {
                  await launcher?.assignGroup(it.id, e.target.value || null);
                  await refresh();
                }}
                aria-label={`Group for ${it.label}`}
                className="shrink-0 w-auto max-w-[6.5rem]"
                selectClassName="bg-th-surface"
              >
                <option value="">— none —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
              </Select>
              <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
                <IconButton label="Move up" size="2xs" onClick={() => void move(it.id, -1)} disabled={i === 0}><ArrowUp size={11} /></IconButton>
                <IconButton label="Move down" size="2xs" onClick={() => void move(it.id, 1)} disabled={i === items.length - 1}><ArrowDown size={11} /></IconButton>
                <IconButton
                  label="Remove"
                  size="2xs"
                  tone="danger"
                  onClick={async () => { await launcher?.removeItem(it.id); await refresh(); }}
                >
                  <X size={11} />
                </IconButton>
              </div>
            </Card>
          ))}

          {groups.length > 0 && (
            <>
              <Label className="block text-3xs mt-2 mb-0.5">Groups</Label>
              {groups.map((g) => (
                <Card key={g.id} variant="inset" padding="none" className="flex items-center gap-2 px-2.5 py-1 group">
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
                  <span className="text-th-hi3 text-3xs shrink-0">
                    {items.filter((it) => it.group === g.id).length} items
                  </span>
                  <IconButton
                    label="Delete group (items are kept)"
                    size="2xs"
                    tone="danger"
                    onClick={async () => { await launcher?.removeGroup(g.id); await refresh(); }}
                    className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                  >
                    <X size={11} />
                  </IconButton>
                </Card>
              ))}
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-th-line pt-3">
          <Button size="sm" icon={<AppWindow size={13} />} onClick={() => void addApp()}>
            Add app…
          </Button>
          <div className="flex gap-1.5">
            <Input
              size="sm"
              value={urlLabel}
              onChange={(e) => setUrlLabel(e.target.value)}
              onKeyDown={onUrlKey}
              placeholder="Label"
              aria-label="Link label"
              className="w-20"
            />
            <Input
              size="sm"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={onUrlKey}
              placeholder="https://…"
              aria-label="Link URL"
              className="flex-1 font-mono"
            />
            <IconButton label="Add link" size="sm" variant="subtle" onClick={() => void addUrl()} disabled={!url.trim()} className="size-8">
              <Plus size={13} />
            </IconButton>
          </div>
          <div className="flex gap-1.5">
            <Input
              size="sm"
              value={groupLabel}
              onChange={(e) => setGroupLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addGroup(); }}
              placeholder="New group…"
              aria-label="New group name"
              className="flex-1"
            />
            <IconButton label="Add group" size="sm" variant="subtle" onClick={() => void addGroup()} disabled={!groupLabel.trim()} className="size-8">
              <FolderPlus size={13} />
            </IconButton>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-th-hi3 text-3xs leading-relaxed">
              App paths stay in the main process — the dashboard launches by id.
            </p>
            <Button
              variant="ghost"
              size="xs"
              loading={refreshingIcons}
              icon={<RefreshCw size={10} />}
              onClick={() => void refreshIcons()}
              title="Re-fetch app icons and favicons"
              className="text-th-hi3"
            >
              Icons
            </Button>
          </div>
        </div>
      </div>
    </Modal>
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
          className="flex flex-col items-center gap-1.5 px-1 py-2.5 rounded-lg hover:bg-th-elevated text-th-hi2 hover:text-th-hi transition-colors"
          title={it.label}
        >
          <ItemIcon item={it} size={18} />
          <span className="text-3xs leading-tight truncate max-w-full">{it.label}</span>
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
        <EmptyState compact icon={<Rocket size={16} />} title="Launcher works in the desktop app" />
      ) : items.length === 0 ? (
        <EmptyState compact icon={<Rocket size={16} />} title="No shortcuts — add some with the pencil" />
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
                    aria-expanded={!isCollapsed}
                    className="flex items-center gap-1 text-th-hi3 hover:text-th-hi2 text-3xs uppercase tracking-wider transition-colors min-w-0"
                    title={isCollapsed ? 'Expand' : 'Collapse'}
                  >
                    {isCollapsed ? <ChevronRight size={11} className="shrink-0" /> : <ChevronDown size={11} className="shrink-0" />}
                    <span className="truncate">{g.label}</span>
                    <span className="tabular-nums">({members.length})</span>
                  </button>
                  <IconButton
                    label={`Launch all in ${g.label}`}
                    size="2xs"
                    onClick={() => void window.electron?.launcher?.launchGroup(g.id)}
                    className="opacity-0 group-hover/hdr:opacity-100 group-focus-within/hdr:opacity-100 focus-visible:opacity-100"
                  >
                    <Play size={11} />
                  </IconButton>
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
