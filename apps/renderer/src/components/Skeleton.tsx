import { cn } from '../lib/utils';

/** Single shimmer block — size it with className (width/height utilities). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton rounded', className)} />;
}

/** Default widget-body loading state: a padded stack of shimmer bars.
 *  Replaces the old per-widget "Loading…" text. */
export function WidgetSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="h-full p-3 flex flex-col gap-2.5 overflow-hidden" aria-busy="true">
      <Skeleton className="h-4 w-2/5" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i % 2 === 0 ? 'w-full' : 'w-4/5')} />
      ))}
    </div>
  );
}
