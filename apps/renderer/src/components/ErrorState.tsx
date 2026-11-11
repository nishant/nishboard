import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppErrorBoundary, ErrorState as NishErrorState } from '@nish/ui';
import { toast } from '../lib/alerts';

/** Widget error state: @nish/ui's compact ErrorState plus a Retry that refetches
 *  the widget's queries immediately instead of waiting for the next poll. */
export function ErrorState({
  message = 'Failed to load',
  queryKey,
}: {
  message?: string;
  /** Query-key prefix to refetch on Retry; omit to hide the button. */
  queryKey?: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (!queryKey) return;
    setRetrying(true);
    try {
      await queryClient.refetchQueries({ queryKey: [...queryKey] }, { throwOnError: true });
    } catch {
      toast('Retry failed', undefined, 'error');
    } finally {
      setRetrying(false);
    }
  }

  return (
    <NishErrorState
      compact
      message={message}
      onRetry={queryKey ? () => void retry() : undefined}
      retrying={retrying}
    />
  );
}

/** Error boundary around one widget body (grid tile or popout): a render throw
 *  (bad payload, failed lazy chunk) shows a compact error with Retry here
 *  instead of unwinding to the root and taking the whole frameless app down.
 *  Resets when the widget id changes. */
export function WidgetBoundary({ id, children }: { id: string; children: ReactNode }) {
  return (
    <AppErrorBoundary
      resetKeys={[id]}
      onError={(error, info) => console.error(`[widget:${id}] render failed`, error, info.componentStack)}
      fallback={({ reset }) => (
        <NishErrorState compact className="h-full" message="This widget crashed" onRetry={reset} />
      )}
    >
      {children}
    </AppErrorBoundary>
  );
}
