import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Pin, ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { PRESETS } from '../../lib/layouts';
import { useLayoutStore } from '../../store/layoutStore';
import type { SavedCustomLayout } from '../../store/layoutStore';
import type { WidgetId } from '../../lib/layouts';
import {
  MenuPopover, MenuTrigger,
  SubmenuHeader, WidgetPinList, SaveAsForm, SavedItemRow, deleteBody,
} from './primitives';
import { ConfirmDialog, IconButton, cn } from '@nish/ui';
import { menuRowClass } from '../nishGaps';

// ── Tile editor (pin/unpin + save) ────────────────────────────────────────────

function CustomLayoutEditor({
  visibleWidgets,
  showWidget,
  hideWidget,
  onBack,
  onSave,
  editTarget,
  onUpdate,
}: {
  visibleWidgets: WidgetId[];
  showWidget: (id: WidgetId) => void;
  hideWidget: (id: WidgetId) => void;
  onBack: () => void;
  onSave: (name: string) => void;
  editTarget?: SavedCustomLayout;
  onUpdate: () => void;
}) {
  return (
    <div className="px-3 py-2 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <IconButton label="Back" size="xs" onClick={onBack} className="size-5 -ml-0.5">
          <ArrowLeft size={12} />
        </IconButton>
        <span className="text-th-hi text-2xs font-semibold">
          {editTarget ? `Edit "${editTarget.name}"` : 'Custom Layout'}
        </span>
      </div>

      <p className="text-th-hi3 text-3xs leading-tight">
        Drag &amp; resize tiles on the dashboard. Toggle which tiles are pinned below, then save.
      </p>

      {/* Pinned-tile toggles — update live */}
      <div className="flex flex-col -mx-1">
        <WidgetPinList
          visibleWidgets={visibleWidgets}
          showWidget={showWidget}
          hideWidget={hideWidget}
          pinTitle="Pin tile"
          unpinTitle="Unpin tile"
        />
      </div>

      <SaveAsForm
        isEdit={!!editTarget}
        placeholder="Layout name…"
        onSave={onSave}
        onUpdate={onUpdate}
      />
    </div>
  );
}

// ── Layouts menu ──────────────────────────────────────────────────────────────

type LayoutPanel = 'list' | 'custom-list' | 'editor';

export function LayoutsMenu({ compact }: { compact: boolean }) {
  const {
    activePreset, applyPreset, pinnedPresets, pinPreset, unpinPreset,
    pinnedCustomLayouts, pinCustomLayout, unpinCustomLayout,
    visibleWidgets, showWidget, hideWidget,
    savedCustomLayouts, activeCustomLayoutId,
    saveCustomLayout, deleteCustomLayout, applyCustomLayout, updateCustomLayout,
  } = useLayoutStore();

  const [open, setOpen]                 = useState(false);
  const [panel, setPanel]               = useState<LayoutPanel>('list');
  const [deleteTarget, setDeleteTarget] = useState<SavedCustomLayout | null>(null);
  const [editTarget, setEditTarget]     = useState<SavedCustomLayout | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function handleClose() {
    setOpen(false);
    setPanel('list');
    setEditTarget(null);
  }

  function handleToggle() {
    if (open) handleClose();
    else { setOpen(true); setPanel('list'); }
  }

  function handleSaveLayout(name: string) {
    saveCustomLayout(name);
    setPanel('custom-list');
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    deleteCustomLayout(deleteTarget.id);
    setDeleteTarget(null);
  }

  // The tile editor keeps the panel open while the dashboard grid is dragged
  // and resized, so presses outside it are ignored there; Escape still closes.
  // (Popover reports one close for Escape and outside presses alike: remember
  // which key fired last.)
  const escapeRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { escapeRef.current = e.key === 'Escape'; };
    const onDown = () => { escapeRef.current = false; };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (next) return;
    if (panel === 'editor' && !escapeRef.current) return;
    handleClose();
  }

  return (
    <div className="app-region-no-drag">
      <MenuTrigger
        ref={triggerRef}
        compact={compact}
        open={open}
        name="Layouts"
        icon={(size) => <LayoutGrid size={size} />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleToggle}
      />

      <MenuPopover
        open={open}
        onOpenChange={handleOpenChange}
        anchor={triggerRef}
        label="Layouts"
        className={cn(panel !== 'list' && 'min-w-[220px]')}
      >
        {/* ── Preset list ── */}
        {panel === 'list' && (
          <>
            {PRESETS.map((preset) => {
              const pinned = pinnedPresets.includes(preset.name);
              return (
                <div key={preset.name} className="flex items-center gap-1 px-1 group">
                  <button
                    type="button"
                    onClick={() => { applyPreset(preset.name); handleClose(); }}
                    aria-current={activePreset === preset.name || undefined}
                    className={cn(menuRowClass(activePreset === preset.name), 'flex-1 w-auto px-2 py-1 rounded')}
                  >
                    {preset.name}
                  </button>
                  <IconButton
                    label={pinned ? 'Unpin from bar' : 'Pin to bar'}
                    size="xs"
                    aria-pressed={pinned}
                    onClick={() => (pinned ? unpinPreset(preset.name) : pinPreset(preset.name))}
                    className={cn('size-5', pinned ? 'text-th-hi2 hover:text-th-loss' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100')}
                  >
                    <Pin size={10} className={pinned ? 'fill-current' : ''} />
                  </IconButton>
                </div>
              );
            })}

            {/* Custom layouts entry */}
            <div role="separator" className="h-px bg-th-line mx-3 my-1" />
            <button
              type="button"
              onClick={() => setPanel('custom-list')}
              className={menuRowClass(!!activeCustomLayoutId)}
            >
              <LayoutGrid size={11} className="shrink-0" />
              Custom
              <ChevronRight size={10} className="ml-auto text-th-hi3" />
            </button>
          </>
        )}

        {/* ── Custom layouts submenu ── */}
        {panel === 'custom-list' && (
          <>
            <SubmenuHeader label="Custom Layouts" onBack={() => setPanel('list')} />

            {/* Create new — always first */}
            <button
              type="button"
              onClick={() => setPanel('editor')}
              className={cn(menuRowClass(), 'mt-0.5')}
            >
              <Plus size={11} className="shrink-0" />
              Create new
            </button>

            {/* Divider + saved layouts */}
            {savedCustomLayouts.length > 0 && (
              <>
                <div role="separator" className="h-px bg-th-line mx-3 my-1" />
                {savedCustomLayouts.map((cl) => {
                  const pinned = pinnedCustomLayouts.includes(cl.id);
                  return (
                    <SavedItemRow
                      key={cl.id}
                      name={cl.name}
                      active={activeCustomLayoutId === cl.id}
                      icon={<LayoutGrid size={11} className="shrink-0 text-th-hi3" />}
                      onApply={() => { applyCustomLayout(cl.id); setEditTarget(cl); setPanel('editor'); }}
                      onDelete={() => setDeleteTarget(cl)}
                      pinned={pinned}
                      onTogglePin={() => (pinned ? unpinCustomLayout(cl.id) : pinCustomLayout(cl.id))}
                    />
                  );
                })}
              </>
            )}
          </>
        )}

        {/* ── Tile editor ── */}
        {panel === 'editor' && (
          <CustomLayoutEditor
            visibleWidgets={visibleWidgets}
            showWidget={showWidget}
            hideWidget={hideWidget}
            onBack={() => { setPanel('custom-list'); setEditTarget(null); }}
            onSave={handleSaveLayout}
            editTarget={editTarget ?? undefined}
            onUpdate={() => {
              updateCustomLayout(editTarget!.id);
              setEditTarget(null);
              setPanel('custom-list');
            }}
          />
        )}
      </MenuPopover>

      {/* Delete confirmation — rendered over everything */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete layout?"
          body={deleteBody(deleteTarget.name)}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
