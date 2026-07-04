import type { ReactNode } from 'react';

/** Unified widget empty state — replaces the various centered grey texts. */
export function EmptyState({ icon, message }: { icon?: ReactNode; message: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-1.5 p-4 text-center">
      {icon && <span className="text-th-ghost">{icon}</span>}
      <p className="text-th-ghost text-xs">{message}</p>
    </div>
  );
}
