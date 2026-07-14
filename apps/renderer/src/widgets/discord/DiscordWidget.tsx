import { useEffect, useRef, useState } from 'react';
import { Home, LogOut, RotateCw, X } from 'lucide-react';
import type { DiscordScreenShareRequestData } from '@dash/shared';
import { HeaderAction } from '../../components/HeaderAction';
import { useDiscordStore } from '../../store/discordStore';
import { DISCORD_APP_URL, DISCORD_HOME_URL, parseDiscordUnreadCount } from './lib';
import type {
  DiscordWebviewElement,
  WebviewDidFailLoadEvent,
  WebviewPageTitleUpdatedEvent,
} from './lib';

// The REAL Discord web app in an Electron <webview> on the persist:discord
// partition (login survives restarts; no keys/OAuth — Nish signs in once in
// the widget). Main-side plumbing lives in apps/main/src/discord.ts: session
// UA/permissions, getDisplayMedia → the picker overlay below, attach guards.
// Registered with keepMounted — collapsing hides the body at h-0 instead of
// unmounting, so voice keeps running.

type LoadStatus = 'loading' | 'ready' | 'error';

/** Keep the picker's local lifetime in sync with main's authoritative timeout. */
const SHARE_PICKER_TIMEOUT_MS = 60_000;

export function DiscordWidget() {
  const webviewRef = useRef<DiscordWebviewElement | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [shareReq, setShareReq] = useState<DiscordScreenShareRequestData | null>(null);
  const unread = useDiscordStore((s) => s.unread);
  const setUnread = useDiscordStore((s) => s.setUnread);
  const registerControls = useDiscordStore((s) => s.registerControls);
  const signOutPrompt = useDiscordStore((s) => s.signOutPrompt);
  const setSignOutPrompt = useDiscordStore((s) => s.setSignOutPrompt);

  const inElectron = window.electron !== undefined;

  // Webview lifecycle events — plain DOM custom events, so ref + addEventListener
  // (React's synthetic system can't subscribe to them).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
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
    wv.addEventListener('did-finish-load', onReady);
    wv.addEventListener('did-fail-load', onFail);
    wv.addEventListener('page-title-updated', onTitle);
    return () => {
      wv.removeEventListener('did-finish-load', onReady);
      wv.removeEventListener('did-fail-load', onFail);
      wv.removeEventListener('page-title-updated', onTitle);
    };
  }, [setUnread]);

  // Screen-share picker host — subscribed ONLY while mounted (main auto-denies
  // getDisplayMedia when nobody is watching).
  useEffect(() => {
    const api = window.electron?.discord;
    if (!api) return;
    void api.setScreenShareWatch(true);
    const unsub = api.onScreenShareRequest(setShareReq);
    return () => {
      unsub();
      void api.setScreenShareWatch(false);
    };
  }, []);

  // Local picker auto-dismiss, matching main's authoritative 60s deny.
  useEffect(() => {
    if (!shareReq) return;
    const t = setTimeout(() => setShareReq(null), SHARE_PICKER_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [shareReq]);

  // Header actions (sibling component) drive the webview through the store.
  useEffect(() => {
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
  }, [registerControls]);

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

  if (!inElectron) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-th-ghost text-xs text-center">
          Discord embeds only inside the desktop app.
        </p>
      </div>
    );
  }

  // Screens before windows in the picker, stable within each group.
  const orderedSources = shareReq
    ? [...shareReq.sources].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'screen' ? -1 : 1))
    : [];

  return (
    <div className="relative h-full w-full">
      <webview
        ref={webviewRef}
        src={DISCORD_APP_URL}
        partition="persist:discord"
        allowpopups
        // Hidden-while-collapsed (keepMounted h-0 wrapper) must not throttle
        // timers — voice runs on.
        webpreferences="backgroundThrottling=false"
        className="h-full w-full"
      />

      {unread > 0 && (
        <div className="absolute top-1.5 right-1.5 z-10 pointer-events-none px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
          {unread}
        </div>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-th-surface">
          <div className="h-4 w-28 rounded bg-th-elevated animate-pulse" />
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
  );
}

export function DiscordActions() {
  const controls = useDiscordStore((s) => s.controls);
  const setSignOutPrompt = useDiscordStore((s) => s.setSignOutPrompt);
  if (!controls) return null; // plain browser / webview not mounted
  return (
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
  );
}
