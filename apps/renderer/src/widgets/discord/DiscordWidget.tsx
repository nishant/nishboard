import { useEffect, useRef } from 'react';
import { AppWindow, Cable, Home, LogOut, RotateCw, Unplug } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { HeaderAction } from '../../components/HeaderAction';
import { useDiscordStore } from '../../store/discordStore';
import { useDiscordUiStore } from '../../store/discordUiStore';
import { DiscordNative } from './DiscordNative';
import { disconnectDiscord, useDiscordStatus } from './useDiscordNative';

// The grid tile for Discord — two modes (persisted in discordUiStore):
//
// 'embed'  — the <webview> does NOT live here. Unmounting a webview destroys
//   the guest abruptly and loses Discord's in-memory auth token (→ logout; see
//   discordStore). The tile just activates the app-lifetime DiscordHost and
//   publishes its body rect every frame; the host overlays it. Unmounting
//   (layout switch, unpin, pop-out, MODE SWITCH) only hides the host — the
//   guest keeps running, signed in and in-voice.
//
// 'native' — DiscordNative renders inline (plain React, no webview): local RPC
//   to the Discord DESKTOP client via /api/discord. The rect publisher must
//   NOT run in this mode — its cleanup pushes setHostRect(null), which parks
//   the (possibly already-activated) host at 0×0.

export function DiscordWidget() {
  const mode = useDiscordUiStore((s) => s.mode);
  const activate = useDiscordStore((s) => s.activate);
  const setHostRect = useDiscordStore((s) => s.setHostRect);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inElectron = window.electron !== undefined;

  useEffect(() => {
    if (!inElectron || mode !== 'embed') return;
    activate();
    const el = bodyRef.current;
    if (!el) return;
    // rAF loop instead of ResizeObserver: RGL animates tiles via CSS transforms
    // (drag/resize/compaction), which observers don't see. One rect read per
    // frame for one element is negligible. Collapsed (keepMounted h-0 wrapper)
    // the rect's height is 0 → host hides itself but stays alive.
    let raf = 0;
    let last = '';
    const tick = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.x},${r.y},${r.width},${r.height}`;
      if (key !== last) {
        last = key;
        setHostRect({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setHostRect(null); // hide the host — the guest stays alive (and logged in)
    };
  }, [inElectron, mode, activate, setHostRect]);

  // Native mode is pure HTTP to the local server — works in the plain-browser
  // dev renderer too, unlike the Electron-only webview embed.
  if (mode === 'native') return <DiscordNative />;

  if (!inElectron) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-th-ghost text-xs text-center">
          Discord embeds only inside the desktop app.
        </p>
      </div>
    );
  }

  return (
    // Padded frame: the ~8px gutter keeps the fixed z-30 host from covering
    // RGL's resize handles — they render INSIDE the grid item (a transformed
    // stacking context, so no z-index can lift them above the host), and
    // without the gutter every handle except n/ne/nw sits under the webview,
    // dead. It also lets the tile's border/background visibly frame the embed.
    // The rAF loop publishes the INNER div's rect, so the host floats inside
    // the gutter.
    <div className="h-full w-full p-2">
      <div ref={bodyRef} className="h-full w-full" />
    </div>
  );
}

export function DiscordActions() {
  const mode = useDiscordUiStore((s) => s.mode);
  const setMode = useDiscordUiStore((s) => s.setMode);
  const controls = useDiscordStore((s) => s.controls);
  const setSignOutPrompt = useDiscordStore((s) => s.setSignOutPrompt);
  // Only polled in native mode — gates the Disconnect action's visibility.
  const status = useDiscordStatus(mode === 'native');
  const queryClient = useQueryClient();

  return (
    <>
      {/* Webview controls are embed-only (the host may not even be live). */}
      {mode === 'embed' && controls && (
        <>
          <HeaderAction title="Home (DMs)" onClick={controls.goHome}>
            <Home size={12} />
          </HeaderAction>
          <HeaderAction title="Reload Discord" onClick={controls.reload}>
            <RotateCw size={12} />
          </HeaderAction>
          <HeaderAction title="Sign out" danger onClick={() => setSignOutPrompt(true)}>
            <LogOut size={12} />
          </HeaderAction>
        </>
      )}
      {mode === 'native' && status.data?.connected && (
        <HeaderAction
          title="Disconnect native mode (revokes the RPC session)"
          danger
          onClick={() => {
            void disconnectDiscord().then(() =>
              queryClient.invalidateQueries({ queryKey: ['discord-status'] }),
            );
          }}
        >
          <Unplug size={12} />
        </HeaderAction>
      )}
      <HeaderAction
        title={mode === 'embed'
          ? 'Switch to native mode (RPC to the Discord desktop app)'
          : 'Switch to embed mode (Discord web)'}
        onClick={() => setMode(mode === 'embed' ? 'native' : 'embed')}
      >
        {mode === 'embed' ? <Cable size={12} /> : <AppWindow size={12} />}
      </HeaderAction>
    </>
  );
}
