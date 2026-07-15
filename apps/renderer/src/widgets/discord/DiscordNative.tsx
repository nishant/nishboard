import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ExternalLink, Hash, HeadphoneOff, Headphones, Loader2, Mic, MicOff, PhoneOff, Volume2,
} from 'lucide-react';
import type {
  DiscordChannelData,
  DiscordGuildData,
  DiscordMessageData,
  DiscordSelectedVoiceData,
  DiscordUserData,
} from '@dash/shared';
import { cn } from '../../lib/utils';
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

// Native Discord mode: guild rail → channel list → read-only live chat feed,
// plus a voice footer (join/leave/mute/deafen + speaking rings). Everything is
// driven by the desktop client over local RPC through /api/discord — this
// component holds NO Discord credentials or endpoints.

function CenterPanel({ title, body, children }: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
      <p className="text-th-hi text-xs font-medium">{title}</p>
      <p className="text-th-ghost text-[11px] max-w-64">{body}</p>
      {children}
    </div>
  );
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
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 size={16} className="animate-spin text-th-ghost" />
      </div>
    );
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
        <button
          onClick={() => void connect()}
          disabled={connecting}
          className="px-3 py-1.5 rounded-full bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors disabled:opacity-50"
        >
          {connecting ? 'Waiting for approval…' : 'Connect'}
        </button>
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
            <span className="w-full h-full flex items-center justify-center bg-th-elevated text-th-hi text-[10px] font-semibold">
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
      {loading && <Loader2 size={12} className="animate-spin text-th-ghost mx-auto my-2" />}
      {textChannels.length > 0 && (
        <p className="px-1.5 pb-1 text-[9px] font-semibold uppercase tracking-widest text-th-ghost">Text</p>
      )}
      {textChannels.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelectText(c.id)}
          className={cn(
            'w-full flex items-center gap-1 px-1.5 py-1 rounded text-left text-[11px] transition-colors',
            c.id === activeChannelId ? 'bg-th-elevated text-th-hi' : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/50',
          )}
        >
          <Hash size={10} className="shrink-0" />
          <span className="truncate">{c.name}</span>
        </button>
      ))}
      {voiceChannels.length > 0 && (
        <p className="px-1.5 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-th-ghost">Voice</p>
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
              'w-full flex items-center gap-1 px-1.5 py-1 rounded text-left text-[11px] transition-colors group',
              joined ? 'text-green-400 bg-th-elevated/60' : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/50',
            )}
          >
            <Volume2 size={10} className="shrink-0" />
            <span className="truncate flex-1">{c.name}</span>
            {!joined && (
              <span className="hidden group-hover:inline text-[9px] text-th-ghost">Join</span>
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
      <div className="flex-1 flex items-center justify-center">
        <p className="text-th-ghost text-[11px]">Pick a text channel</p>
      </div>
    );
  }
  return (
    <>
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-th-line">
        <Hash size={11} className="text-th-ghost shrink-0" />
        <span className="text-th-hi text-[11px] font-medium truncate flex-1">{channel.name}</span>
        <button
          title="Open this channel in the Discord app to reply"
          onClick={() => void replyInDiscord(channel.id)}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-th-ghost hover:text-th-hi hover:bg-th-elevated/60 transition-colors"
        >
          <ExternalLink size={10} />
          Reply in Discord
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-1 py-1.5">
        {loading && <Loader2 size={12} className="animate-spin text-th-ghost mx-auto my-2" />}
        {!loading && messages.length === 0 && (
          <p className="text-th-ghost text-[11px] text-center py-3">No recent messages</p>
        )}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} self={m.author.id === selfId} />
        ))}
      </div>
      <div className="shrink-0 px-2 py-1 border-t border-th-line">
        <p className="text-th-ghost text-[10px] select-none">
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
        <span className={cn('text-[10px] font-semibold', self ? 'text-th-accent' : 'text-th-3')}>
          {message.author.username}
        </span>
        <span className="text-th-ghost text-[9px] ml-1.5">
          {formatMessageTime(message.timestamp)}
          {message.edited && ' (edited)'}
        </span>
        {/* Plain text only — React escapes it; no markdown pipeline in v1. */}
        <p className="text-th-hi text-[11px] whitespace-pre-wrap break-words leading-snug">{message.content}</p>
        {(message.attachmentCount > 0 || message.hasEmbeds) && (
          <p className="text-th-ghost text-[9px] italic">
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
        speaking && 'ring-2 ring-green-500',
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
      <Volume2 size={11} className="text-green-400 shrink-0" />
      <span className="text-th-hi text-[10px] font-medium truncate">
        {voice.channelName ?? 'Voice'}
      </span>
      <div className="flex items-center -space-x-1 flex-1 min-w-0 pl-1">
        {voice.members.map((m) => (
          <MemberAvatar key={m.userId} name={m.name} avatarUrl={m.avatarUrl} size={16} speaking={m.speaking} />
        ))}
      </div>
      <button
        title={settings?.mute ? 'Unmute' : 'Mute'}
        onClick={() => void toggle({ mute: !settings?.mute })}
        className={cn(
          'p-1 rounded transition-colors',
          settings?.mute ? 'text-red-400 bg-red-400/10' : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/60',
        )}
      >
        {settings?.mute ? <MicOff size={11} /> : <Mic size={11} />}
      </button>
      <button
        title={settings?.deaf ? 'Undeafen' : 'Deafen'}
        onClick={() => void toggle({ deaf: !settings?.deaf })}
        className={cn(
          'p-1 rounded transition-colors',
          settings?.deaf ? 'text-red-400 bg-red-400/10' : 'text-th-ghost hover:text-th-hi hover:bg-th-elevated/60',
        )}
      >
        {settings?.deaf ? <HeadphoneOff size={11} /> : <Headphones size={11} />}
      </button>
      <button
        title="Leave voice"
        onClick={() => void selectDiscordVoice(null)}
        className="p-1 rounded text-th-ghost hover:text-red-400 hover:bg-red-400/10 transition-colors"
      >
        <PhoneOff size={11} />
      </button>
    </div>
  );
}
