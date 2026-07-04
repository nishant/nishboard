import { useState } from 'react';
import { AlertTriangle, RotateCw, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '../lib/alerts';

/** Unified widget error state: icon + message + a manual Retry that refetches
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
    <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
      <AlertTriangle size={16} className="text-red-400/80 shrink-0" />
      <p className="text-th-3 text-xs leading-relaxed max-w-[36ch]">{message}</p>
      {queryKey && (
        <button
          onClick={retry}
          disabled={retrying}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-th-line hover:border-th-3 text-th-3 hover:text-th-hi transition-colors text-[10px] disabled:opacity-50"
        >
          {retrying ? <Loader2 size={10} className="animate-spin" /> : <RotateCw size={10} />}
          Retry
        </button>
      )}
    </div>
  );
}
