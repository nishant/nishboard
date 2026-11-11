import { useEffect, useRef } from 'react';
import { AppWindow, Cable, Home, LogOut, RotateCw, Unplug } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '@nish/ui';
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
//   publishes its body rect (see the effect below); the host overlays it. Unmounting
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
    // RGL animates tiles via CSS transforms (drag/resize/compaction), which
    // observers don't see, so a rAF loop republishes the rect — but ONLY while
    // a grid gesture is in progress (store.interacting) and for SETTLE_MS after
    // any layout change (the RGL transition). A permanent loop keeps the
    // compositor awake 24/7 on an ambient dashboard. Otherwise the rect comes
    // from a ResizeObserver, window 'resize' and a capture-phase 'scroll'
    // listener (catches the grid scroller). Collapsed (keepMounted h-0 wrapper)
    // the rect's height is 0 → host hides itself but stays alive.
    const SETTLE_MS = 400;
    let raf = 0;
    let last = '';
    let loopUntil = 0;
    const publish = (): void => {
      const r = el.getBoundingClientRect();
      const key = `${r.x},${r.y},${r.width},${r.height}`;
      if (key !== last) {
        last = key;
        setHostRect({ x: r.x, y: r.y, width: r.width, height: r.height });
      }
    };
    const tick = (): void => {
      raf = 0;
      publish();
      if (useDiscordStore.getState().interacting || performance.now() < loopUntil) {
        raf = requestAnimationFrame(tick);
      }
    };
    const burst = (): void => {
      loopUntil = performance.now() + SETTLE_MS;
      if (raf === 0) raf = requestAnimationFrame(tick);
    };
    publish();
    burst(); // the tile may still be animating into place on mount
    const ro = new ResizeObserver(() => {
      publish();
      burst();
    });
    ro.observe(el);
    window.addEventListener('resize', burst);
    window.addEventListener('scroll', publish, { capture: true, passive: true });
    const unsubscribe = useDiscordStore.subscribe((state, prev) => {
      if (state.interacting !== prev.interacting) burst();
    });
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', burst);
      window.removeEventListener('scroll', publish, { capture: true });
      unsubscribe();
      setHostRect(null); // hide the host — the guest stays alive (and logged in)
    };
  }, [inElectron, mode, activate, setHostRect]);

  // Native mode is pure HTTP to the local server — works in the plain-browser
  // dev renderer too, unlike the Electron-only webview embed.
  if (mode === 'native') return <DiscordNative />;

  if (!inElectron) {
    return <EmptyState compact className="h-full" title="Discord embeds only inside the desktop app." />;
  }

  return (
    // Padded frame: the ~8px gutter keeps the fixed z-30 host from covering
    // RGL's resize handles — they render INSIDE the grid item (a transformed
    // stacking context, so no z-index can lift them above the host), and
    // without the gutter every handle except n/ne/nw sits under the webview,
    // dead. It also lets the tile's border/background visibly frame the embed.
    // The publisher reads the INNER div's rect, so the host floats inside
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
  const unread = useDiscordStore((s) => s.unread);

  return (
    <>
      {unread > 0 && (
        <span
          title={`${unread} unread mention${unread === 1 ? '' : 's'}`}
          className="px-1.5 py-0.5 rounded-full bg-th-loss-fill text-th-on-loss text-3xs font-semibold leading-none"
        >
          {unread}
        </span>
      )}
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
