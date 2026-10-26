import { forwardRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode, CSSProperties, RefObject } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Pin, X } from 'lucide-react';
import { WIDGET_CATEGORIES, WIDGET_TITLES } from '../../lib/layouts';
import type { WidgetId } from '../../lib/layouts';
import { orderedCategoryWidgets, useWidgetUiStore } from '../../store/widgetUiStore';
import { useAppSettingsStore } from '../../store/settingsStore';
import { Button, IconButton, Input, Popover, cn, Label, menuItemClass } from '@nish/ui';

// WebkitAppRegion is a non-standard Electron CSS property missing from React's
// CSSProperties — the cast is unavoidable.
export const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
export const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

/** Right-side titlebar menu trigger. `compact` → the shared IconButton (xs,
 *  label = name); otherwise a ghost xs Button with icon + text. `open` gives it
 *  the pressed look. Forwards its ref so Popover / DropdownMenu can anchor to it.
 *  `extra` renders after the label (ThemeMenu's swatch dot). */
export const MenuTrigger = forwardRef<HTMLButtonElement, {
  compact: boolean;
  open: boolean;
  name: string;
  icon: (size: number) => ReactNode;
  extra?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'name'>>(function MenuTrigger(
  { compact, open, name, icon, extra, className, ...rest },
  ref,
) {
  if (compact) {
    return (
      <IconButton ref={ref} label={name} size="xs" active={open} className={cn('relative', className)} {...rest}>
        {icon(13)}
        {extra}
      </IconButton>
    );
  }
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="xs"
      icon={icon(11)}
      className={cn('font-normal', open ? 'bg-th-elevated text-th-hi' : 'text-th-hi3', className)}
      {...rest}
    >
      {name}
      {extra}
    </Button>
  );
});

/** A titlebar menu panel: the shared Popover (portal, Escape, outside press,
 *  focus return), right-aligned under its trigger, dense, and outside the
 *  Electron drag region. `dismissOnOutside={false}` keeps it open on outside
 *  presses (Escape and Tab-out still close it). */
export function MenuPopover({
  open, onOpenChange, dismissOnOutside, anchor, label, className, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dismissOnOutside?: boolean;
  anchor: RefObject<HTMLElement | null>;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      dismissOnOutside={dismissOnOutside}
      anchor={anchor}
      align="end"
      aria-label={label}
      className={cn('app-region-no-drag p-0 py-1 text-xs min-w-[148px]', className)}
    >
      {children}
    </Popover>
  );
}

/** Back-arrow + uppercase label header used by every submenu panel. */
export function SubmenuHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-1 pb-2 border-b border-th-line">
      <IconButton label="Back" size="2xs" onClick={onBack} className="-ml-0.5">
        <ArrowLeft size={12} />
      </IconButton>
      <Label className="text-3xs">{label}</Label>
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
      size="2xs"
      onClick={onMove}
      disabled={atBoundary}
      className={atBoundary ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'}
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
            <Label className="block px-3 pt-1.5 pb-0.5 text-3xs">
              {category.label}
            </Label>
            {ids.map((id, idx) => {
              const visible = visibleWidgets.includes(id);
              return (
                <div key={id} className="flex items-center gap-0.5 pl-3 pr-1 group">
                  <span className={cn(
                    'flex-1 px-2 py-1 text-2xs min-w-0 truncate',
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
                    size="2xs"
                    onClick={() => (visible ? hideWidget(id) : showWidget(id))}
                    aria-pressed={visible}
                    className={visible ? 'text-th-hi2 hover:text-th-loss' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'}
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
          <Label className="text-3xs">Save as</Label>
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
        aria-current={active || undefined}
        className={menuItemClass({ active, className: 'flex-1 w-auto px-2 rounded min-w-0 text-2xs' })}
      >
        {icon}
        <span className="truncate">{name}</span>
      </button>
      {onTogglePin && (
        <IconButton
          label={pinned ? 'Unpin from bar' : 'Pin to bar'}
          size="2xs"
          onClick={onTogglePin}
          aria-pressed={pinned}
          className={pinned ? 'text-th-hi2 hover:text-th-loss' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'}
        >
          <Pin size={10} className={pinned ? 'fill-current' : ''} />
        </IconButton>
      )}
      <IconButton
        label={`Delete "${name}"`}
        size="2xs"
        tone="danger"
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
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
