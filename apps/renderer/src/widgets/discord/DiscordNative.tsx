import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink, Hash, HeadphoneOff, Headphones, Mic, MicOff, PhoneOff, Volume2,
} from 'lucide-react';
import type {
  DiscordChannelData,
  DiscordGuildData,
  DiscordMessageData,
  DiscordSelectedVoiceData,
  DiscordUserData,
} from '@dash/shared';
import { toast } from '../../lib/alerts';
import {
  connectDiscord,
  replyInDiscord,
  selectDiscordVoice,
  setDiscordVoiceSettings,
  useDiscordChannelDetail,
  useDiscordChannels,
  useDiscordGuilds,
  useDiscordStatus,
  useDiscordStream,
  useDiscordVoiceSettings,
} from './useDiscordNative';
import { applyMessageEvent, applySpeaking, formatMessageTime, guildInitials } from './nativeLib';
import { Button, EmptyState, IconButton, SkeletonLines, cn, Label } from '@nish/ui';

// Native Discord mode: guild rail → channel list → read-only live chat feed,
// plus a voice footer (join/leave/mute/deafen + speaking rings). Everything is
// driven by the desktop client over local RPC through /api/discord — this
// component holds NO Discord credentials or endpoints.

function CenterPanel({ title, body, children }: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return <EmptyState compact className="h-full" title={title} detail={body} action={children} />;
}

export function DiscordNative() {
  const status = useDiscordStatus(true);
  const [connecting, setConnecting] = useState(false);
  const queryClient = useQueryClient();

  const connect = async (): Promise<void> => {
    setConnecting(true);
    try {
      const result = await connectDiscord();
      if (result) queryClient.setQueryData(['discord-status'], result);
    } finally {
      setConnecting(false);
    }
  };

  if (status.isLoading) {
    return <SkeletonLines lines={4} className="h-full overflow-hidden" />;
  }
  const data = status.data;
  if (!data || !data.configured) {
    return (
      <CenterPanel
        title="Discord app credentials missing"
        body="Add DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in Settings → Developer (an application you own, redirect http://localhost:7432/api/discord/callback)."
      />
    );
  }
  if (!data.running) {
    return (
      <CenterPanel
        title="Discord isn't running"
        body="Native mode talks to the Discord DESKTOP app over its local RPC pipe — launch Discord and this widget connects automatically."
      />
    );
  }
  if (!data.connected) {
    return (
      <CenterPanel
        title="Connect to Discord"
        body={connecting
          ? 'Approve the authorization prompt inside the Discord app…'
          : 'One-time approval — Discord pops a consent prompt in its own window.'}
      >
        <Button size="sm" variant="primary" loading={connecting} onClick={() => void connect()}>
          {connecting ? 'Waiting for approval…' : 'Connect'}
        </Button>
      </CenterPanel>
    );
  }
  return <DiscordNativeConnected user={data.user} />;
}

function DiscordNativeConnected({ user }: { user: DiscordUserData | undefined }) {
  const guildsQuery = useDiscordGuilds(true);
  const guilds = guildsQuery.data ?? [];
  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const activeGuildId = guildId ?? guilds[0]?.id ?? null;

  const channelsQuery = useDiscordChannels(activeGuildId);
  const channels = channelsQuery.data ?? [];
  const textChannels = channels.filter((c) => c.kind === 'text');
  const voiceChannels = channels.filter((c) => c.kind === 'voice');
  // Default to the guild's first text channel once channels load.
  const activeChannelId = channelId ?? textChannels[0]?.id ?? null;

  // Feed: seeded from the REST detail, then folded live from stream frames.
  const detailQuery = useDiscordChannelDetail(activeChannelId);
  const [messages, setMessages] = useState<DiscordMessageData[]>([]);
  useEffect(() => {
    setMessages(detailQuery.data?.messages ?? []);
  }, [detailQuery.data]);

  // Voice roster arrives on every stream open and on each change.
  const [voice, setVoice] = useState<DiscordSelectedVoiceData | null>(null);

  useDiscordStream({
    enabled: true,
    channelId: activeChannelId,
    onEvent: (event) => {
      switch (event.type) {
        case 'voice-roster':
          setVoice(event.voice);
          break;
        case 'speaking':
          setVoice((v) => applySpeaking(v, event.userId, event.speaking));
          break;
        case 'message':
        case 'message-delete':
          setMessages((m) => applyMessageEvent(m, event));
          break;
        case 'notification':
          if (event.title) toast('Discord', `${event.title}${event.body ? ` — ${event.body}` : ''}`);
          break;
        case 'state':
          // Pipe transitions end the stream server-side; the hook refetches
          // status and the panels above take over. Nothing to do per frame.
          break;
      }
    },
  });

  const selectGuild = (id: string): void => {
    setGuildId(id);
    setChannelId(null); // re-defaults to the new guild's first text channel
  };

  return (
    <div className="h-full flex min-h-0">
      <GuildRail guilds={guilds} activeId={activeGuildId} onSelect={selectGuild} />
      <ChannelList
        loading={channelsQuery.isLoading}
        textChannels={textChannels}
        voiceChannels={voiceChannels}
        activeChannelId={activeChannelId}
        voice={voice}
        onSelectText={setChannelId}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <ChatFeed
          channel={channels.find((c) => c.id === activeChannelId) ?? null}
          loading={detailQuery.isLoading}
          messages={messages}
          selfId={user?.id ?? null}
        />
        {voice?.channelId != null && <VoiceFooter voice={voice} />}
      </div>
    </div>
  );
}

function GuildRail({ guilds, activeId, onSelect }: {
  guilds: DiscordGuildData[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="w-11 shrink-0 border-r border-th-line overflow-y-auto py-1.5 flex flex-col items-center gap-1.5">
      {guilds.map((g) => (
        <button
          key={g.id}
          title={g.name}
          onClick={() => onSelect(g.id)}
          className={cn(
            'w-8 h-8 shrink-0 rounded-full overflow-hidden flex items-center justify-center transition-all',
            g.id === activeId
              ? 'ring-2 ring-th-accent'
              : 'opacity-70 hover:opacity-100 hover:rounded-xl',
          )}
        >
          {g.iconUrl ? (
            <img src={g.iconUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="w-full h-full flex items-center justify-center bg-th-elevated text-th-hi text-3xs font-semibold">
              {guildInitials(g.name)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function ChannelList({ loading, textChannels, voiceChannels, activeChannelId, voice, onSelectText }: {
  loading: boolean;
  textChannels: DiscordChannelData[];
  voiceChannels: DiscordChannelData[];
  activeChannelId: string | null;
  voice: DiscordSelectedVoiceData | null;
  onSelectText: (id: string) => void;
}) {
  return (
    <div className="w-36 shrink-0 border-r border-th-line overflow-y-auto py-1.5 px-1">
      {loading && <SkeletonLines lines={3} className="p-1" />}
      {textChannels.length > 0 && (
        <Label className="block px-1.5 pb-1 text-3xs font-semibold tracking-widest">Text</Label>
      )}
      {textChannels.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelectText(c.id)}
          className={cn(
            'w-full flex items-center gap-1 px-1.5 py-1 rounded text-left text-2xs transition-colors',
            c.id === activeChannelId ? 'bg-th-elevated text-th-hi' : 'text-th-hi3 hover:text-th-hi hover:bg-th-elevated',
          )}
        >
          <Hash size={10} className="shrink-0" />
          <span className="truncate">{c.name}</span>
        </button>
      ))}
      {voiceChannels.length > 0 && (
        <Label className="block px-1.5 pt-2 pb-1 text-3xs font-semibold tracking-widest">Voice</Label>
      )}
      {voiceChannels.map((c) => {
        const joined = voice?.channelId === c.id;
        return (
          <button
            key={c.id}
            title={joined ? 'Connected' : `Join ${c.name}`}
            onClick={() => {
              if (!joined) void selectDiscordVoice(c.id);
            }}
            className={cn(
              'w-full flex items-center gap-1 px-1.5 py-1 rounded text-left text-2xs transition-colors group',
              joined ? 'text-th-ok bg-th-elevated' : 'text-th-hi3 hover:text-th-hi hover:bg-th-elevated',
            )}
          >
            <Volume2 size={10} className="shrink-0" />
            <span className="truncate flex-1">{c.name}</span>
            {!joined && (
              <span className="hidden group-hover:inline group-focus-visible:inline text-3xs text-th-hi3">Join</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ChatFeed({ channel, loading, messages, selfId }: {
  channel: DiscordChannelData | null;
  loading: boolean;
  messages: DiscordMessageData[];
  selfId: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Pin to the bottom as messages stream in (feed is newest-at-bottom).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!channel) {
    return (
      <EmptyState compact className="flex-1" title="Pick a text channel" />
    );
  }
  return (
    <>
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-th-line">
        <Hash size={11} className="text-th-hi3 shrink-0" />
        <span className="text-th-hi text-2xs font-medium truncate flex-1">{channel.name}</span>
        <Button
          variant="ghost"
          size="xs"
          title="Open this channel in the Discord app to reply"
          icon={<ExternalLink size={10} />}
          onClick={() => void replyInDiscord(channel.id)}
          className="text-th-hi3"
        >
          Reply in Discord
        </Button>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-1 py-1.5">
        {loading && <SkeletonLines lines={3} />}
        {!loading && messages.length === 0 && <EmptyState compact title="No recent messages" />}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} self={m.author.id === selfId} />
        ))}
      </div>
      <div className="shrink-0 px-2 py-1 border-t border-th-line">
        <p className="text-th-hi3 text-3xs select-none">
          Read-only feed — use “Reply in Discord” to answer.
        </p>
      </div>
    </>
  );
}

function MessageRow({ message, self }: { message: DiscordMessageData; self: boolean }) {
  return (
    <div className="flex gap-1.5 px-1 py-0.5">
      <MemberAvatar name={message.author.username} avatarUrl={message.author.avatarUrl} size={18} />
      <div className="min-w-0 flex-1">
        <span className={cn('text-3xs font-semibold', self ? 'text-th-accent' : 'text-th-hi3')}>
          {message.author.username}
        </span>
        <span className="text-th-hi3 text-3xs ml-1.5">
          {formatMessageTime(message.timestamp)}
          {message.edited && ' (edited)'}
        </span>
        {/* Plain text only — React escapes it; no markdown pipeline in v1. */}
        <p className="text-th-hi text-2xs whitespace-pre-wrap break-words leading-snug">{message.content}</p>
        {(message.attachmentCount > 0 || message.hasEmbeds) && (
          <p className="text-th-hi3 text-3xs italic">
            {message.attachmentCount > 0 && `${message.attachmentCount} attachment${message.attachmentCount > 1 ? 's' : ''}`}
            {message.attachmentCount > 0 && message.hasEmbeds && ' · '}
            {message.hasEmbeds && 'embed'}
          </p>
        )}
      </div>
    </div>
  );
}

function MemberAvatar({ name, avatarUrl, size, speaking = false }: {
  name: string;
  avatarUrl: string | null;
  size: number;
  speaking?: boolean;
}) {
  return (
    <span
      title={name}
      className={cn(
        'shrink-0 rounded-full overflow-hidden flex items-center justify-center bg-th-elevated transition-shadow',
        // Green speaking ring — the whole point of the voice roster.
        speaking && 'ring-2 ring-th-ok-fill',
      )}
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-th-hi font-semibold" style={{ fontSize: Math.max(8, size * 0.4) }}>
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function VoiceFooter({ voice }: { voice: DiscordSelectedVoiceData }) {
  const queryClient = useQueryClient();
  const settingsQuery = useDiscordVoiceSettings(true);
  const settings = settingsQuery.data;

  const toggle = async (patch: { mute?: boolean; deaf?: boolean }): Promise<void> => {
    const next = await setDiscordVoiceSettings(patch);
    if (next) queryClient.setQueryData(['discord-voice-settings'], next);
  };

  return (
    <div className="shrink-0 border-t border-th-line px-2 py-1.5 flex items-center gap-2">
      <Volume2 size={11} className="text-th-ok shrink-0" />
      <span className="text-th-hi text-3xs font-medium truncate">
        {voice.channelName ?? 'Voice'}
      </span>
      <div className="flex items-center -space-x-1 flex-1 min-w-0 pl-1">
        {voice.members.map((m) => (
          <MemberAvatar key={m.userId} name={m.name} avatarUrl={m.avatarUrl} size={16} speaking={m.speaking} />
        ))}
      </div>
      <IconButton
        label={settings?.mute ? 'Unmute' : 'Mute'}
        size="xs"
        tone="danger"
        active={settings?.mute === true}
        onClick={() => void toggle({ mute: !settings?.mute })}
      >
        {settings?.mute ? <MicOff size={11} /> : <Mic size={11} />}
      </IconButton>
      <IconButton
        label={settings?.deaf ? 'Undeafen' : 'Deafen'}
        size="xs"
        tone="danger"
        active={settings?.deaf === true}
        onClick={() => void toggle({ deaf: !settings?.deaf })}
      >
        {settings?.deaf ? <HeadphoneOff size={11} /> : <Headphones size={11} />}
      </IconButton>
      <IconButton label="Leave voice" size="xs" tone="danger" onClick={() => void selectDiscordVoice(null)}>
        <PhoneOff size={11} />
      </IconButton>
    </div>
  );
}
