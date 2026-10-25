import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorState as NishErrorState } from '@nish/ui';
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
      await queryClient.refetchQueries({ queryKey: [...queryKey] });
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
