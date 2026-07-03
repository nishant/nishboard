import { useState } from 'react';
import { LayoutGrid, Pin, ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { PRESETS } from '../../lib/layouts';
import { useLayoutStore } from '../../store/layoutStore';
import type { SavedCustomLayout } from '../../store/layoutStore';
import type { WidgetId } from '../../lib/layouts';
import { cn } from '../../lib/utils';
import {
  Backdrop, menuBtn, menuPanel, noDragStyle,
  SubmenuHeader, WidgetPinList, SaveAsForm, SavedItemRow, ConfirmDeleteDialog,
} from './primitives';

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
        <button
          onClick={onBack}
          className="text-th-ghost hover:text-th-hi transition-colors p-0.5 -ml-0.5"
        >
          <ArrowLeft size={12} />
        </button>
        <span className="text-th-hi text-[11px] font-semibold">
          {editTarget ? `Edit "${editTarget.name}"` : 'Custom Layout'}
        </span>
      </div>

      <p className="text-th-ghost text-[9px] leading-tight">
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
    visibleWidgets, showWidget, hideWidget,
    savedCustomLayouts, activeCustomLayoutId,
    saveCustomLayout, deleteCustomLayout, applyCustomLayout, updateCustomLayout,
  } = useLayoutStore();

  const [open, setOpen]                 = useState(false);
  const [panel, setPanel]               = useState<LayoutPanel>('list');
  const [deleteTarget, setDeleteTarget] = useState<SavedCustomLayout | null>(null);
  const [editTarget, setEditTarget]     = useState<SavedCustomLayout | null>(null);

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

  return (
    <div className="relative" style={noDragStyle}>
      <button onClick={handleToggle} className={menuBtn(open, compact)} title="Layouts">
        <LayoutGrid size={compact ? 13 : 11} />
        {!compact && 'Layouts'}
      </button>

      {open && (
        <>
          {/* No backdrop while editing so the dashboard grid stays draggable/resizable */}
          {panel !== 'editor' && <Backdrop onClose={handleClose} />}

          <div
            className={cn(menuPanel, panel !== 'list' && 'min-w-[220px]')}
            style={noDragStyle}
          >
            {/* ── Preset list ── */}
            {panel === 'list' && (
              <>
                {PRESETS.map((preset) => {
                  const pinned = pinnedPresets.includes(preset.name);
                  return (
                    <div key={preset.name} className="flex items-center gap-1 px-1 group">
                      <button
                        onClick={() => { applyPreset(preset.name); handleClose(); }}
                        className={cn(
                          'flex-1 text-left px-2 py-1 rounded text-[11px] transition-colors',
                          activePreset === preset.name
                            ? 'text-th-hi bg-th-elevated'
                            : 'text-th-2 hover:text-th-hi hover:bg-th-elevated/60',
                        )}
                      >
                        {preset.name}
                      </button>
                      <button
                        onClick={() => (pinned ? unpinPreset(preset.name) : pinPreset(preset.name))}
                        title={pinned ? 'Unpin from bar' : 'Pin to bar'}
                        className={cn(
                          'p-1 rounded transition-colors shrink-0',
                          pinned
                            ? 'text-th-2 hover:text-red-400'
                            : 'text-th-ghost hover:text-th-2 opacity-0 group-hover:opacity-100',
                        )}
                      >
                        <Pin size={10} className={pinned ? 'fill-current' : ''} />
                      </button>
                    </div>
                  );
                })}

                {/* Custom layouts entry */}
                <div className="h-px bg-th-line mx-3 my-1" />
                <button
                  onClick={() => setPanel('custom-list')}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] transition-colors',
                    activeCustomLayoutId
                      ? 'text-th-hi bg-th-elevated'
                      : 'text-th-2 hover:text-th-hi hover:bg-th-elevated/60',
                  )}
                >
                  <LayoutGrid size={11} className="shrink-0" />
                  Custom
                  <ChevronRight size={10} className="ml-auto text-th-ghost" />
                </button>
              </>
            )}

            {/* ── Custom layouts submenu ── */}
            {panel === 'custom-list' && (
              <>
                <SubmenuHeader label="Custom Layouts" onBack={() => setPanel('list')} />

                {/* Create new — always first */}
                <button
                  onClick={() => setPanel('editor')}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-th-2 hover:text-th-hi hover:bg-th-elevated/60 transition-colors mt-0.5"
                >
                  <Plus size={11} className="shrink-0" />
                  Create new
                </button>

                {/* Divider + saved layouts */}
                {savedCustomLayouts.length > 0 && (
                  <>
                    <div className="h-px bg-th-line mx-3 my-1" />
                    {savedCustomLayouts.map((cl) => (
                      <SavedItemRow
                        key={cl.id}
                        name={cl.name}
                        active={activeCustomLayoutId === cl.id}
                        icon={<LayoutGrid size={11} className="shrink-0 text-th-ghost" />}
                        onApply={() => { applyCustomLayout(cl.id); setEditTarget(cl); setPanel('editor'); }}
                        onDelete={() => setDeleteTarget(cl)}
                      />
                    ))}
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
          </div>

          {/* Delete confirmation — rendered over everything */}
          {deleteTarget && (
            <ConfirmDeleteDialog
              kind="layout"
              name={deleteTarget.name}
              onConfirm={handleConfirmDelete}
              onCancel={() => setDeleteTarget(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
