import { useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Pin, X } from 'lucide-react';
import { WIDGET_CATEGORIES, WIDGET_TITLES } from '../../lib/layouts';
import type { WidgetId } from '../../lib/layouts';
import { orderedCategoryWidgets, useWidgetUiStore } from '../../store/widgetUiStore';
import { useAppSettingsStore } from '../../store/settingsStore';
import { Button, IconButton, cn } from '@nish/ui';
import { Input } from '../nishGaps';

// WebkitAppRegion is a non-standard Electron CSS property missing from React's
// CSSProperties — the cast is unavoidable.
export const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
export const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export function Backdrop({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40" style={noDragStyle} onClick={onClose} />
  );
}

// Right-side titlebar menu button. `compact` → icon-only 24px square (label in
// `title`); otherwise icon + text label.
export const menuBtn = (open: boolean, compact: boolean) =>
  cn(
    compact
      ? 'flex items-center justify-center w-6 h-6 rounded transition-colors'
      : 'flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] transition-colors',
    open
      ? 'bg-th-elevated text-th-hi'
      : 'text-th-hi3 hover:text-th-hi hover:bg-th-elevated',
  );

export const menuPanel =
  'absolute right-0 top-full mt-1 z-50 bg-th-surface border border-th-line rounded-lg shadow-pop py-1 min-w-[148px]';

/** Back-arrow + uppercase label header used by every submenu panel. */
export function SubmenuHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-2 border-b border-th-line">
      <IconButton label="Back" size="xs" onClick={onBack} className="size-5 -ml-0.5">
        <ArrowLeft size={12} />
      </IconButton>
      <span className="text-th-hi3 text-[10px] uppercase tracking-wider font-medium">{label}</span>
    </div>
  );
}

/** Hover-reveal up/down arrow for reordering a WidgetPinList row. Boundary
 *  rows render it invisible (still occupying space, so columns stay aligned). */
function MoveButton({
  direction, atBoundary, onMove,
}: {
  direction: -1 | 1;
  atBoundary: boolean;
  onMove: () => void;
}) {
  const Icon = direction === -1 ? ChevronUp : ChevronDown;
  return (
    <IconButton
      label={direction === -1 ? 'Move up' : 'Move down'}
      size="xs"
      onClick={onMove}
      disabled={atBoundary}
      className={cn('size-5', atBoundary ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100')}
    >
      <Icon size={11} />
    </IconButton>
  );
}

/** The widget pin/unpin toggle list, grouped under category headings — shared
 *  by the Widgets menu and the custom-layout editor (they differ only in the
 *  tooltip wording). Row order within a category is user-adjustable via the
 *  hover arrows (persisted in widgetUiStore.menuOrder); widgets disabled in
 *  Settings → Widgets are omitted entirely. */
export function WidgetPinList({
  visibleWidgets, showWidget, hideWidget, pinTitle, unpinTitle,
}: {
  visibleWidgets: WidgetId[];
  showWidget: (id: WidgetId) => void;
  hideWidget: (id: WidgetId) => void;
  pinTitle: string;
  unpinTitle: string;
}) {
  const menuOrder = useWidgetUiStore((s) => s.menuOrder);
  const moveWidget = useWidgetUiStore((s) => s.moveWidget);
  const disabledWidgets = useAppSettingsStore((s) => s.disabledWidgets);

  return (
    <>
      {WIDGET_CATEGORIES.map((category) => {
        const ids = orderedCategoryWidgets(category, menuOrder).filter(
          (id) => !disabledWidgets.includes(id),
        );
        if (ids.length === 0) return null;
        return (
          <div key={category.id}>
            <p className="px-3 pt-1.5 pb-0.5 text-th-hi3 text-[10px] uppercase tracking-wider font-medium">
              {category.label}
            </p>
            {ids.map((id, idx) => {
              const visible = visibleWidgets.includes(id);
              return (
                <div key={id} className="flex items-center gap-0.5 pl-3 pr-1 group">
                  <span className={cn(
                    'flex-1 px-2 py-1 text-[11px] min-w-0 truncate',
                    visible ? 'text-th-hi2' : 'text-th-hi3',
                  )}>
                    {WIDGET_TITLES[id]}
                  </span>
                  <MoveButton
                    direction={-1}
                    atBoundary={idx === 0}
                    onMove={() => moveWidget(category.id, id, -1)}
                  />
                  <MoveButton
                    direction={1}
                    atBoundary={idx === ids.length - 1}
                    onMove={() => moveWidget(category.id, id, 1)}
                  />
                  <IconButton
                    label={`${visible ? unpinTitle : pinTitle}: ${WIDGET_TITLES[id]}`}
                    size="xs"
                    onClick={() => (visible ? hideWidget(id) : showWidget(id))}
                    aria-pressed={visible}
                    className={cn(
                      'size-5',
                      visible ? 'text-th-hi2 hover:text-th-loss' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
                    )}
                  >
                    <Pin size={10} className={visible ? 'fill-current' : ''} />
                  </IconButton>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

/** "Save as" name form (create mode) or a single "Save changes" button (edit
 *  mode) — the footer shared by the custom-layout and custom-theme editors. */
export function SaveAsForm({
  isEdit, placeholder, onSave, onUpdate,
}: {
  isEdit: boolean;
  placeholder: string;
  onSave: (name: string) => void;
  onUpdate: () => void;
}) {
  const [saveName, setSaveName] = useState('');

  function handleSave() {
    if (isEdit) {
      onUpdate();
    } else {
      const name = saveName.trim();
      if (!name) return;
      onSave(name);
      setSaveName('');
    }
  }

  return (
    <div className="border-t border-th-line pt-2.5 flex flex-col gap-1.5">
      {isEdit ? (
        <Button size="xs" variant="primary" onClick={handleSave} className="w-full">
          Save changes
        </Button>
      ) : (
        <>
          <span className="text-th-hi3 text-[9px] uppercase tracking-wider">Save as</span>
          <div className="flex gap-1.5">
            <Input
              size="xs"
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder={placeholder}
              aria-label="Save as"
              maxLength={32}
              className="flex-1 text-3xs"
            />
            <Button size="xs" variant="primary" onClick={handleSave} disabled={!saveName.trim()}>
              Save
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A saved-item row: apply button (icon/swatch + name, active highlight) with
 *  a hover-reveal delete X — shared by saved layouts and saved themes. Pass
 *  `onTogglePin` to also render a pin-to-titlebar toggle (saved layouts). */
export function SavedItemRow({
  active, name, icon, onApply, onDelete, pinned = false, onTogglePin,
}: {
  active: boolean;
  name: string;
  icon: ReactNode;
  onApply: () => void;
  onDelete: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-1 group">
      <button
        onClick={onApply}
        className={cn(
          'flex-1 flex items-center gap-2 px-2 py-1.5 text-[11px] rounded transition-colors min-w-0',
          active
            ? 'text-th-hi bg-th-elevated'
            : 'text-th-hi2 hover:text-th-hi hover:bg-th-elevated',
        )}
      >
        {icon}
        <span className="truncate">{name}</span>
      </button>
      {onTogglePin && (
        <IconButton
          label={pinned ? 'Unpin from bar' : 'Pin to bar'}
          size="xs"
          onClick={onTogglePin}
          aria-pressed={pinned}
          className={cn('size-5', pinned ? 'text-th-hi2 hover:text-th-loss' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100')}
        >
          <Pin size={10} className={pinned ? 'fill-current' : ''} />
        </IconButton>
      )}
      <IconButton
        label={`Delete "${name}"`}
        size="xs"
        tone="danger"
        onClick={onDelete}
        className="size-5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
      >
        <X size={11} />
      </IconButton>
    </div>
  );
}

/** Body copy for a delete confirmation (shared ConfirmDialog) — layouts and themes. */
export function deleteBody(name: string): ReactNode {
  return (
    <>
      <span className="font-medium text-th-hi">&ldquo;{name}&rdquo;</span> will be permanently removed. This cannot be
      undone.
    </>
  );
}
