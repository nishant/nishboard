import { Volume2, VolumeX, Volume1, Volume } from 'lucide-react';
import { useSound, useSetVolume, useSetMute, useSwitchDevice, useSetSessionVolume } from './useSound';
import { useDeferredSlider } from '../../hooks/useDeferredSlider';
import { WidgetSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { RefreshAction } from '../../components/RefreshAction';
import type { AudioDevice, AudioSession } from '@dash/shared';

/** WidgetShell header actions for the sound tile. */
export function SoundActions() {
  return <RefreshAction queryKey={['sound']} title="Refresh audio state" />;
}

function VolumeIcon({ vol, muted }: { vol: number; muted: boolean }) {
  if (muted || vol === 0) return <VolumeX size={14} className="shrink-0" />;
  if (vol < 33) return <Volume size={14} className="shrink-0" />;
  if (vol < 66) return <Volume1 size={14} className="shrink-0" />;
  return <Volume2 size={14} className="shrink-0" />;
}

function VolumeSlider({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const { sliderProps } = useDeferredSlider(value, onChange);

  return (
    <input
      type="range"
      min={0}
      max={100}
      disabled={disabled}
      {...sliderProps}
      className="w-full h-1 rounded-full appearance-none cursor-pointer
        bg-th-overlay accent-th-accent
        disabled:opacity-40 disabled:cursor-not-allowed"
    />
  );
}

function DeviceItem({
  device,
  onSwitch,
  switching,
}: {
  device: AudioDevice;
  onSwitch: (id: string) => void;
  switching: boolean;
}) {
  return (
    <button
      onClick={() => !device.isDefault && onSwitch(device.id)}
      disabled={device.isDefault || switching}
      className={[
        'w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-2',
        device.isDefault
          ? 'bg-th-overlay/50 text-th-hi cursor-default'
          : 'text-th-2 hover:bg-th-elevated hover:text-th-hi',
      ].join(' ')}
    >
      <span
        className={[
          'h-1.5 w-1.5 rounded-full shrink-0',
          device.isDefault ? 'bg-emerald-400' : 'bg-th-ghost',
        ].join(' ')}
      />
      <span className="truncate">{device.name}</span>
    </button>
  );
}

function SessionRow({ session, onCommit }: { session: AudioSession; onCommit: (pid: number, vol: number) => void }) {
  const { value: local, sliderProps } = useDeferredSlider(
    session.volumePercent,
    (v) => onCommit(session.pid, v),
  );

  return (
    <div className="flex items-center gap-2 group">
      <span className="text-th-2 text-[11px] truncate w-28 shrink-0 group-hover:text-th-hi transition-colors">
        {session.name}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        {...sliderProps}
        className="flex-1 h-1 rounded-full appearance-none cursor-pointer bg-th-overlay accent-th-accent"
      />
      <span className="text-th-3 text-[10px] tabular-nums font-mono w-7 text-right shrink-0">
        {local}%
      </span>
    </div>
  );
}

export function SoundWidget() {
  const { data, isLoading, isError } = useSound();
  const setVolume = useSetVolume();
  const setMute = useSetMute();
  const switchDevice = useSwitchDevice();
  const setSessionVolume = useSetSessionVolume();

  const muted = data?.muted ?? false;
  const vol = data?.volumePercent ?? 0;

  if (isLoading) {
    return <WidgetSkeleton lines={3} />;
  }

  if (isError || !data) {
    return <ErrorState message="Sound unavailable" queryKey={['sound']} />;
  }

  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto">

      {/* ── Master volume ── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setMute.mutate(!muted)}
            className={[
              'flex items-center gap-1.5 text-xs font-medium transition-colors',
              muted ? 'text-red-400 hover:text-red-300' : 'text-th-hi hover:text-th-hi',
            ].join(' ')}
          >
            <VolumeIcon vol={vol} muted={muted} />
            Volume
          </button>
          <span className="text-[11px] tabular-nums text-th-3 font-mono">
            {muted ? 'muted' : `${vol}%`}
          </span>
        </div>
        {/* Stays enabled while muted — pre-setting the level before unmuting is
            the natural gesture; forcing unmute-first was a papercut. */}
        <VolumeSlider
          value={vol}
          onChange={(v) => setVolume.mutate(v)}
        />
      </div>

      {/* ── Output device ── */}
      {data.devices.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-th-ghost px-0.5">Output</span>
          {data.devices.map((d) => (
            <DeviceItem
              key={d.id}
              device={d}
              onSwitch={(id) => switchDevice.mutate(id)}
              switching={switchDevice.isPending}
            />
          ))}
        </div>
      )}

      {/* ── App mixer (Windows only) ── */}
      {data.sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] uppercase tracking-wider text-th-ghost px-0.5">
            App Mixer
          </span>
          {data.sessions.map((s) => (
            <SessionRow
              key={s.pid}
              session={s}
              onCommit={(pid, volumePercent) => setSessionVolume.mutate({ pid, volumePercent })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
