import type { ReactNode } from 'react';
import { cn } from '@nish/ui';

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
            ? 'text-th-hi3 hover:text-th-loss hover:bg-th-loss-soft'
            : 'text-th-hi3 hover:text-th-hi hover:bg-th-elevated/60',
      )}
    >
      {children}
    </button>
  );
}
