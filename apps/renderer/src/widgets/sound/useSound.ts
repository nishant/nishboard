import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/apiClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import type { SoundData } from '@dash/shared';

export function useSound() {
  const interval = useGatedInterval(5000);
  return useQuery<SoundData>({
    queryKey: ['sound'],
    queryFn: () => apiClient.get<SoundData>('/api/sound'),
    refetchInterval: interval,
    staleTime: 4000,
    // osascript can be slow on first cold-boot of a freshly spawned child process
    retry: 5,
    retryDelay: 1500,
  });
}

export function useSetVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (volumePercent: number) =>
      apiClient.post('/api/sound/volume', { volumePercent }),
    onMutate: (volumePercent) => {
      void qc.cancelQueries({ queryKey: ['sound'] });
      const previous = qc.getQueryData<SoundData>(['sound']);
      qc.setQueryData<SoundData>(['sound'], (old) =>
        old ? { ...old, volumePercent } : old,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['sound'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sound'] }),
  });
}

export function useSetMute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (muted: boolean) => apiClient.post('/api/sound/mute', { muted }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sound'] }),
  });
}

export function useSwitchDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => apiClient.post('/api/sound/device', { deviceId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sound'] }),
  });
}

export function useSetSessionVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pid, volumePercent }: { pid: number; volumePercent: number }) =>
      apiClient.post('/api/sound/sessions/volume', { pid, volumePercent }),
    onMutate: ({ pid, volumePercent }) => {
      void qc.cancelQueries({ queryKey: ['sound'] });
      const previous = qc.getQueryData<SoundData>(['sound']);
      qc.setQueryData<SoundData>(['sound'], (old) =>
        old
          ? { ...old, sessions: old.sessions.map((s) => (s.pid === pid ? { ...s, volumePercent } : s)) }
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['sound'], ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['sound'] }),
  });
}
