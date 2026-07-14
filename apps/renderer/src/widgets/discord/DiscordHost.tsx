import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DiscordScreenShareRequestData } from '@dash/shared';
import { HeaderAction } from '../../components/HeaderAction';
import { cn } from '../../lib/utils';
import { useDiscordStore } from '../../store/discordStore';
import {
  DISCORD_APP_URL,
  DISCORD_COMPACT_CSS,
  DISCORD_HOME_URL,
  nextHostStyle,
  parseDiscordUnreadCount,
  zoomForWidth,
} from './lib';
import type {
  DiscordHostSize,
  DiscordWebviewElement,
  WebviewDidFailLoadEvent,
  WebviewPageTitleUpdatedEvent,
} from './lib';

// App-lifetime home of the Discord <webview> (persist:discord partition).
// Mounted ONCE per window (App / discord PopoutShell), position:fixed, and
// driven by discordStore: the DiscordWidget tile activates it and publishes
// its body rect; the host overlays that rect. When the tile is collapsed,
// unpinned, or missing from the current layout the host shrinks to 0×0 —
// NEVER unmounts and NEVER display:none — so the guest (and its in-memory
// auth token, see discordStore) survives: signed in + voice for the whole
// app session. z-30: above grid tiles, below menus (z-40+) and every portal
// (modals z-[200], toasts z-[300], palette z-[400]).

type LoadStatus = 'loading' | 'ready' | 'error';

/** Keep the picker's local lifetime in sync with main's authoritative timeout. */
const SHARE_PICKER_TIMEOUT_MS = 60_000;

/** Out-of-gesture size changes (window resize, density switch) apply after
 *  the rect has been stable this long — never per rAF frame. */
const SIZE_SETTLE_MS = 120;

export function DiscordHost() {
  const webviewRef = useRef<DiscordWebviewElement | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [shareReq, setShareReq] = useState<DiscordScreenShareRequestData | null>(null);
  // Last size actually applied to the webview container — position tracks the
  // live rect per frame, size only moves on settle (see nextHostStyle).
  const [settledSize, setSettledSize] = useState<DiscordHostSize | null>(null);
  // Counts dom-ready fires: 0 = guest methods (setZoomFactor/insertCSS) would
  // still throw; bumps on every load so per-load state (zoom) is re-applied.
  const [domReadyTick, setDomReadyTick] = useState(0);
  const wasInteracting = useRef(false);
  const active = useDiscordStore((s) => s.active);
  const hostRect = useDiscordStore((s) => s.hostRect);
  const interacting = useDiscordStore((s) => s.interacting);
  const unread = useDiscordStore((s) => s.unread);
  const setUnread = useDiscordStore((s) => s.setUnread);
  const registerControls = useDiscordStore((s) => s.registerControls);
  const signOutPrompt = useDiscordStore((s) => s.signOutPrompt);
  const setSignOutPrompt = useDiscordStore((s) => s.setSignOutPrompt);

  const inElectron = window.electron !== undefined;

  // Webview lifecycle events — plain DOM custom events, so ref + addEventListener
  // (React's synthetic system can't subscribe to them). `active` gates: the
  // webview only exists in the DOM after activation.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onDomReady = () => {
      // Fires on every top-level load (reload included) — inserted CSS and
      // zoom don't survive navigation. The compact CSS is fail-soft: if its
      // hashed-class prefix stops matching, the stock layout just shows.
      void wv.insertCSS(DISCORD_COMPACT_CSS);
      setDomReadyTick((t) => t + 1); // unlocks + re-triggers the zoom effect
    };
    const onReady = () => setStatus('ready');
    const onFail = (e: Event) => {
      const ev = e as WebviewDidFailLoadEvent;
      // -3 = ERR_ABORTED: fired by Discord's own rapid in-app navigations.
      // Subframe failures (ads/telemetry) are also not fatal.
      if (ev.isMainFrame && ev.errorCode !== -3) setStatus('error');
    };
    const onTitle = (e: Event) => {
      setUnread(parseDiscordUnreadCount((e as WebviewPageTitleUpdatedEvent).title));
    };
    wv.addEventListener('dom-ready', onDomReady);
    wv.addEventListener('did-finish-load', onReady);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('page-title-updated', onTitle);
    return () => {
      wv.removeEventListener('dom-ready', onDomReady);
      wv.removeEventListener('did-finish-load', onReady);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('page-title-updated', onTitle);
    };
  }, [active, setUnread]);

  // Size settling — the ONLY place settledSize changes. Adopt the live rect's
  // size: immediately when the tile hides/first shows or a grid gesture just
  // ended (apply the final size once); debounced SIZE_SETTLE_MS otherwise
  // (window resizes stream per-frame rects with interacting=false). While a
  // gesture is in flight ('hold') the size stays frozen at the last settled
  // value — only the host's position tracks the drag.
  useEffect(() => {
    const justEnded = wasInteracting.current && !interacting;
    wasInteracting.current = interacting;
    const { settle } = nextHostStyle(hostRect, interacting, settledSize);
    if (settle === 'hold') return;
    const adopt = () =>
      setSettledSize(hostRect ? { width: hostRect.width, height: hostRect.height } : null);
    if (settle === 'immediate' || justEnded) {
      adopt();
      return;
    }
    const t = setTimeout(adopt, SIZE_SETTLE_MS);
    return () => clearTimeout(t);
  }, [hostRect, interacting, settledSize]);

  // Auto zoom, stepped by the SETTLED width — never per frame. `zoom` is
  // derived, so the effect only fires when the width crosses a zoomForWidth
  // breakpoint (or when a load/reload bumps domReadyTick and the factor must
  // be re-applied).
  const zoom = settledSize && settledSize.width > 0 ? zoomForWidth(settledSize.width) : null;
  useEffect(() => {
    if (domReadyTick === 0 || zoom === null) return; // guest not ready / tile hidden
    webviewRef.current?.setZoomFactor(zoom);
  }, [domReadyTick, zoom]);

  // Screen-share picker — subscribed for the host's whole life (main
  // auto-denies getDisplayMedia when nobody is watching).
  useEffect(() => {
    const api = window.electron?.discord;
    if (!api || !active) return;
    void api.setScreenShareWatch(true);
    const unsub = api.onScreenShareRequest(setShareReq);
    return () => {
      unsub();
      void api.setScreenShareWatch(false);
    };
  }, [active]);

  // Local picker auto-dismiss, matching main's authoritative 60s deny.
  useEffect(() => {
    if (!shareReq) return;
    const t = setTimeout(() => setShareReq(null), SHARE_PICKER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [shareReq]);

  // Header actions (in the widget tile) drive the webview through the store.
  useEffect(() => {
    if (!active) return;
    registerControls({
      reload: () => {
        setStatus('loading');
        webviewRef.current?.reload();
      },
      goHome: () => {
        void webviewRef.current?.loadURL(DISCORD_HOME_URL);
      },
    });
    return () => registerControls(null);
  }, [active, registerControls]);

  const answerShare = (sourceId: string | null): void => {
    if (!shareReq) return;
    void window.electron?.discord.selectScreenShareSource(shareReq.requestId, sourceId);
    setShareReq(null);
  };

  const confirmSignOut = async (): Promise<void> => {
    await window.electron?.discord.signOut();
    setSignOutPrompt(false);
    setUnread(0);
    setStatus('loading');
    webviewRef.current?.reload();
  };

  if (!inElectron || !active) return null;

  // Screens before windows in the picker, stable within each group.
  const orderedSources = shareReq
    ? [...shareReq.sources].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1))
    : [];

  // Tile hidden → 0×0 (guest alive). NEVER display:none — it kills the guest.
  // Position tracks the live rect per frame; size is settled/frozen (see
  // nextHostStyle). rounded-md on ALL corners — the host floats inside the
  // tile's padded gutter, so every corner is visible.
  const { style } = nextHostStyle(hostRect, interacting, settledSize);

  return (
    <div
      // pointer-events-none during grid gestures: RGL's drag/resize mousemoves
      // must reach the grid, not the guest.
      className={cn('fixed z-30 overflow-hidden rounded-md', interacting && 'pointer-events-none')}
      style={style}
    >
      <div className="relative h-full w-full">
        <webview
          ref={webviewRef}
          src={DISCORD_APP_URL}
          partition="persist:discord"
          allowpopups
          // Hidden-at-0×0 must not throttle timers — voice runs on.
          webpreferences="backgroundThrottling=false"
          className="h-full w-full"
        />

        {unread > 0 && (
          <div className="absolute top-1.5 right-1.5 z-10 pointer-events-none px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
            {unread}
          </div>
        )}

        {status === 'loading' && (
          // Discord's own dark chrome color — the splash must not flash the
          // app theme (white in light mode) before the guest paints.
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#313338]">
            <div className="h-4 w-28 rounded bg-white/10 animate-pulse" />
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-th-surface p-4">
            <p className="text-th-ghost text-xs">Discord failed to load</p>
            <button
              onClick={() => {
                setStatus('loading');
                webviewRef.current?.reload();
              }}
              className="px-3 py-1.5 rounded-full bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {shareReq && (
          <div className="absolute inset-0 z-20 flex flex-col gap-2 bg-th-surface/95 backdrop-blur-sm p-3">
            <div className="flex items-center justify-between shrink-0">
              <span className="text-xs font-medium text-th-3 uppercase tracking-widest">
                Share your screen
              </span>
              <HeaderAction title="Cancel" onClick={() => answerShare(null)}>
                <X size={12} />
              </HeaderAction>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 gap-2 auto-rows-min">
              {orderedSources.map((s) => (
                <button
                  key={s.id}
                  onClick={() => answerShare(s.id)}
                  className="flex flex-col gap-1 rounded-md border border-th-line hover:border-th-hi/40 bg-th-elevated/40 p-1.5 text-left transition-colors"
                >
                  <img src={s.thumbnail} alt="" className="w-full aspect-video object-cover rounded bg-black/40" />
                  <span className="flex items-center gap-1 min-w-0">
                    {s.appIcon && <img src={s.appIcon} alt="" className="w-3.5 h-3.5 shrink-0" />}
                    <span className="truncate text-[11px] text-th-hi">{s.name}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {signOutPrompt && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-th-surface/95 backdrop-blur-sm p-4">
            <p className="text-th-hi text-xs font-medium">Sign out of Discord?</p>
            <p className="text-th-ghost text-[11px] text-center">
              Clears the embedded session — you'll log in again next time.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void confirmSignOut()}
                className="px-3 py-1.5 rounded-full bg-red-500/15 hover:bg-red-500/25 text-red-400 text-[11px] transition-colors"
              >
                Sign out
              </button>
              <button
                onClick={() => setSignOutPrompt(false)}
                className="px-3 py-1.5 rounded-full bg-th-elevated hover:bg-th-overlay text-th-hi text-[11px] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
