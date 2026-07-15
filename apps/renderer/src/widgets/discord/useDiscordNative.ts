import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DiscordChannelData,
  DiscordChannelDetailData,
  DiscordGuildData,
  DiscordSelectedVoiceData,
  DiscordSelectTextChannelRequestBody,
  DiscordStatusData,
  DiscordStreamEvent,
  DiscordVoiceSelectRequestBody,
  DiscordVoiceSettingsData,
  DiscordVoiceSettingsRequestBody,
} from '@dash/shared';
import { apiClient } from '../../lib/apiClient';
import { getEventStream } from '../../lib/streamClient';
import { useGatedInterval } from '../../hooks/useGatedInterval';
import { toast } from '../../lib/alerts';

// Data layer for the native (local-RPC) Discord mode. All Discord traffic goes
// through the Fastify /api/discord routes — the renderer never touches the
// pipe or any Discord endpoint directly.

/** Pipe reachability + auth state. Drives the widget's not-running / connect /
 *  connected panels; cheap on the server (the pipe stays connected). */
export function useDiscordStatus(enabled: boolean) {
  const interval = useGatedInterval(15_000);
  return useQuery<DiscordStatusData>({
    queryKey: ['discord-status'],
    queryFn: () => apiClient.get<DiscordStatusData>('/api/discord/status'),
    enabled,
    refetchInterval: interval,
    staleTime: 10_000,
  });
}

export function useDiscordGuilds(enabled: boolean) {
  return useQuery<DiscordGuildData[]>({
    queryKey: ['discord-guilds'],
    queryFn: async () => (await apiClient.get<{ guilds: DiscordGuildData[] }>('/api/discord/guilds')).guilds,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useDiscordChannels(guildId: string | null) {
  return useQuery<DiscordChannelData[]>({
    queryKey: ['discord-channels', guildId],
    queryFn: async () =>
      (await apiClient.get<{ channels: DiscordChannelData[] }>(`/api/discord/guilds/${guildId}/channels`)).channels,
    enabled: guildId !== null,
    staleTime: 60_000,
  });
}

/** Channel detail = the initial ~50 messages; live updates ride the stream. */
export function useDiscordChannelDetail(channelId: string | null) {
  return useQuery<DiscordChannelDetailData>({
    queryKey: ['discord-channel', channelId],
    queryFn: () => apiClient.get<DiscordChannelDetailData>(`/api/discord/channels/${channelId}`),
    enabled: channelId !== null,
    staleTime: 30_000,
  });
}

export function useDiscordVoiceSettings(enabled: boolean) {
  return useQuery<DiscordVoiceSettingsData>({
    queryKey: ['discord-voice-settings'],
    queryFn: () => apiClient.get<DiscordVoiceSettingsData>('/api/discord/voice/settings'),
    enabled,
    staleTime: 10_000,
  });
}

/**
 * The live SSE feed (GET /api/discord/stream): voice roster + speaking rings,
 * message create/update/delete for `channelId`, notifications, and state
 * transitions. Viewing a different channel re-opens the stream (the effect
 * key includes channelId; the server follows the newest subscriber).
 * The server ENDS the stream when the pipe drops (Discord quit) — that
 * resolves the fetch, and we refetch status so the widget flips panels.
 */
export function useDiscordStream(opts: {
  enabled: boolean;
  channelId: string | null;
  onEvent: (e: DiscordStreamEvent) => void;
}): void {
  const { enabled, channelId } = opts;
  const queryClient = useQueryClient();
  // Ref so a re-rendered handler doesn't tear the stream down.
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;
    const finish = (): void => {
      if (cancelled) return;
      void queryClient.invalidateQueries({ queryKey: ['discord-status'] });
    };
    void getEventStream<DiscordStreamEvent>(
      `/api/discord/stream${channelId !== null ? `?channelId=${encodeURIComponent(channelId)}` : ''}`,
      { signal: controller.signal, onEvent: (e) => onEventRef.current(e) },
    ).then(finish, finish);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, channelId, queryClient]);
}

// ── Imperative actions (plain functions + toast, like the Claude widget) ─────

export async function connectDiscord(): Promise<DiscordStatusData | null> {
  try {
    return await apiClient.post<DiscordStatusData>('/api/discord/connect');
  } catch (err: unknown) {
    toast('Discord', err instanceof Error ? err.message : String(err), 'error');
    return null;
  }
}

export async function disconnectDiscord(): Promise<void> {
  try {
    await apiClient.post('/api/discord/disconnect');
  } catch (err: unknown) {
    toast('Discord', err instanceof Error ? err.message : String(err), 'error');
  }
}

/** Join (id) or leave (null) a voice channel via the desktop client. */
export async function selectDiscordVoice(channelId: string | null): Promise<DiscordSelectedVoiceData | null> {
  try {
    const body: DiscordVoiceSelectRequestBody = { channelId };
    return await apiClient.post<DiscordSelectedVoiceData>('/api/discord/voice/select', body);
  } catch (err: unknown) {
    toast('Discord', err instanceof Error ? err.message : String(err), 'error');
    return null;
  }
}

export async function setDiscordVoiceSettings(
  patch: DiscordVoiceSettingsRequestBody,
): Promise<DiscordVoiceSettingsData | null> {
  try {
    return await apiClient.post<DiscordVoiceSettingsData>('/api/discord/voice/settings', patch);
  } catch (err: unknown) {
    toast('Discord', err instanceof Error ? err.message : String(err), 'error');
    return null;
  }
}

/** "Reply in Discord" — jumps the DESKTOP client to the channel. */
export async function replyInDiscord(channelId: string): Promise<void> {
  try {
    const body: DiscordSelectTextChannelRequestBody = { channelId };
    await apiClient.post('/api/discord/select-text-channel', body);
    toast('Discord', 'Opened the channel in Discord — reply there.');
  } catch (err: unknown) {
    toast('Discord', err instanceof Error ? err.message : String(err), 'error');
  }
}
