import { useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { ArrowLeft, Pin, X } from 'lucide-react';
import { ALL_WIDGET_IDS, WIDGET_TITLES } from '../../lib/layouts';
import type { WidgetId } from '../../lib/layouts';
import { cn } from '../../lib/utils';

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
      : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/60',
  );

export const menuPanel =
  'absolute right-0 top-full mt-1 z-50 bg-th-surface border border-th-line rounded-lg shadow-xl py-1 min-w-[148px]';

/** Back-arrow + uppercase label header used by every submenu panel. */
export function SubmenuHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-2 border-b border-th-line">
      <button
        onClick={onBack}
        className="text-th-ghost hover:text-th-hi transition-colors p-0.5 -ml-0.5"
      >
        <ArrowLeft size={12} />
      </button>
      <span className="text-th-3 text-[10px] uppercase tracking-wider font-medium">{label}</span>
    </div>
  );
}

/** The widget pin/unpin toggle list — shared by the Widgets menu and the
 *  custom-layout editor (they differ only in the tooltip wording). */
export function WidgetPinList({
  visibleWidgets, showWidget, hideWidget, pinTitle, unpinTitle,
}: {
  visibleWidgets: WidgetId[];
  showWidget: (id: WidgetId) => void;
  hideWidget: (id: WidgetId) => void;
  pinTitle: string;
  unpinTitle: string;
}) {
  return (
    <>
      {ALL_WIDGET_IDS.map((id) => {
        const visible = visibleWidgets.includes(id);
        return (
          <div key={id} className="flex items-center gap-1 px-1 group">
            <span className={cn(
              'flex-1 px-2 py-1 text-[11px]',
              visible ? 'text-th-2' : 'text-th-ghost',
            )}>
              {WIDGET_TITLES[id]}
            </span>
            <button
              onClick={() => (visible ? hideWidget(id) : showWidget(id))}
              title={visible ? unpinTitle : pinTitle}
              className={cn(
                'p-1 rounded transition-colors shrink-0',
                visible
                  ? 'text-th-2 hover:text-red-400'
                  : 'text-th-ghost hover:text-th-2 opacity-0 group-hover:opacity-100',
              )}
            >
              <Pin size={10} className={visible ? 'fill-current' : ''} />
            </button>
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
        <button
          onClick={handleSave}
          className="w-full px-2.5 py-1.5 text-[10px] bg-th-overlay hover:bg-th-overlay/70 text-th-hi rounded transition-colors shrink-0"
        >
          Save changes
        </button>
      ) : (
        <>
          <span className="text-th-ghost text-[9px] uppercase tracking-wider">Save as</span>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              placeholder={placeholder}
              maxLength={32}
              className="flex-1 bg-th-elevated border border-th-line rounded px-2 py-1 text-[10px] text-th-hi placeholder:text-th-ghost focus:outline-none focus:border-th-3 transition-colors"
            />
            <button
              onClick={handleSave}
              disabled={!saveName.trim()}
              className="px-2.5 py-1 text-[10px] bg-th-overlay hover:bg-th-overlay/70 text-th-hi rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              Save
            </button>
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
            : 'text-th-2 hover:text-th-hi hover:bg-th-elevated/60',
        )}
      >
        {icon}
        <span className="truncate">{name}</span>
      </button>
      {onTogglePin && (
        <button
          onClick={onTogglePin}
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
      )}
      <button
        onClick={onDelete}
        title={`Delete "${name}"`}
        className="p-1 rounded text-th-ghost hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
      >
        <X size={11} />
      </button>
    </div>
  );
}

/** Fixed delete-confirmation dialog — shared by layouts and themes. */
export function ConfirmDeleteDialog({
  kind, name, onConfirm, onCancel,
}: {
  /** Lowercase noun for the title, e.g. "layout" / "theme". */
  kind: string;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      style={noDragStyle}
    >
      <div className="bg-th-surface border border-th-line rounded-xl p-5 w-72 shadow-2xl flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-th-hi text-sm font-semibold">Delete {kind}?</span>
          <span className="text-th-3 text-[11px] leading-relaxed">
            <span className="text-th-hi font-medium">"{name}"</span> will be
            permanently removed. This cannot be undone.
          </span>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] text-th-2 hover:text-th-hi bg-th-elevated hover:bg-th-overlay rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-[11px] font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
