import type { ReactNode } from 'react';
import { IconButton } from '@nish/ui';

/** Icon button for the WidgetShell header action row: the shared IconButton
 *  (2xs, ghost; danger tone for destructive actions). WidgetShell holds the
 *  row at 22px so the header keeps its height (44px on touch, COARSE_TITLEBAR_PX) (TITLEBAR_PX in
 *  store/layoutStore.ts). `title` becomes the IconButton label, which sets both
 *  aria-label and title (tests query by title). */
export function HeaderAction({
  title,
  onClick,
  active = false,
  danger = false,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <IconButton
      label={title}
      size="2xs"
      active={active}
      tone={danger ? 'danger' : 'neutral'}
      // Coarse pointers: an invisible 44px hit area (20px button + 12px each side)
      // that does not change the visible size.
      className="relative pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-['']"
      onClick={onClick}
    >
      {children}
    </IconButton>
  );
}
