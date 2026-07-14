import { useEffect, useRef } from 'react';
import { Home, LogOut, RotateCw } from 'lucide-react';
import { HeaderAction } from '../../components/HeaderAction';
import { useDiscordStore } from '../../store/discordStore';

// The grid tile for Discord. The <webview> does NOT live here — unmounting a
// webview destroys the guest abruptly and loses Discord's in-memory auth token
// (→ logout; see discordStore). The tile just activates the app-lifetime
// DiscordHost and publishes its body rect every frame; the host overlays it.
// Unmounting (layout switch, unpin, pop-out) only hides the host — the guest
// keeps running, signed in and in-voice.

export function DiscordWidget() {
  const activate = useDiscordStore((s) => s.activate);
  const setHostRect = useDiscordStore((s) => s.setHostRect);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const inElectron = window.electron !== undefined;

  useEffect(() => {
    if (!inElectron) return;
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
  }, [inElectron, activate, setHostRect]);

  if (!inElectron) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-th-ghost text-xs text-center">
          Discord embeds only inside the desktop app.
        </p>
      </div>
    );
  }

  return <div ref={bodyRef} className="h-full w-full" />;
}

export function DiscordActions() {
  const controls = useDiscordStore((s) => s.controls);
  const setSignOutPrompt = useDiscordStore((s) => s.setSignOutPrompt);
  if (!controls) return null; // plain browser / host not live yet
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
