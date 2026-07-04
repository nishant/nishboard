import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/** Icon button for the WidgetShell header action row — uniform 22px square. */
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
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'flex items-center justify-center w-[22px] h-[22px] rounded transition-colors',
        active
          ? 'bg-th-overlay text-th-hi'
          : danger
            ? 'text-th-ghost hover:text-red-400 hover:bg-red-400/10'
            : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/60',
      )}
    >
      {children}
    </button>
  );
}
