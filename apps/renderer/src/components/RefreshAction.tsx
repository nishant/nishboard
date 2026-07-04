import { RotateCw } from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { HeaderAction } from './HeaderAction';
import { cn } from '../lib/utils';

/** Standard per-widget refresh header action — refetches the widget's queries
 *  by key prefix and spins while anything under that key is in flight. */
export function RefreshAction({ queryKey, title = 'Refresh' }: { queryKey: readonly unknown[]; title?: string }) {
  const queryClient = useQueryClient();
  const fetching = useIsFetching({ queryKey: [...queryKey] }) > 0;

  return (
    <HeaderAction title={title} onClick={() => void queryClient.refetchQueries({ queryKey: [...queryKey] })}>
      <RotateCw size={11} className={cn(fetching && 'animate-spin')} />
    </HeaderAction>
  );
}
