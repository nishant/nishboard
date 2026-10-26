import type { ReactNode } from 'react';
import { IconButton } from '@nish/ui';

/** Icon button for the WidgetShell header action row: the shared IconButton
 *  (xs, ghost; danger tone for destructive actions), held at 22px so the
 *  WidgetShell header keeps its height (TITLEBAR_PX in store/layoutStore.ts).
 *  `title` becomes the IconButton label, which sets both aria-label and title
 *  (tests query by title). */
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
      size="xs"
      active={active}
      tone={danger ? 'danger' : 'neutral'}
      onClick={onClick}
      className="size-[22px] rounded"
    >
      {children}
    </IconButton>
  );
}
