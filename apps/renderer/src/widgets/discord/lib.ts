// NOTE: the <webview> JSX intrinsic itself comes from @types/react
// (WebViewHTMLAttributes — allowpopups/partition/src/webpreferences are all
// typed there); only the runtime method surface + event payloads we drive are
// declared here. The renderer deliberately has no electron types dependency.

import type { DiscordHostRect } from '../../store/discordStore';

/** The subset of Electron's WebviewTag API the Discord widget uses.
 *  Signatures pinned against electron@33.4.11 electron.d.ts (WebviewTag). */
export interface DiscordWebviewElement extends HTMLElement {
  reload(): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  /** Guest zoom. Throws if called before the webview's first dom-ready. */
  setZoomFactor(factor: number): void;
  /** Resolves with a removal key. Inserted CSS does NOT survive navigation. */
  insertCSS(css: string): Promise<string>;
}

/** `did-fail-load` webview DOM event payload (subset). */
export interface WebviewDidFailLoadEvent extends Event {
  errorCode: number;
  errorDescription: string;
  isMainFrame: boolean;
}

/** `page-title-updated` webview DOM event payload (subset). */
export interface WebviewPageTitleUpdatedEvent extends Event {
  title: string;
}

export const DISCORD_APP_URL = 'https://discord.com/app';
export const DISCORD_HOME_URL = 'https://discord.com/channels/@me';

/** Mention count from the Discord tab title — "(3) Discord | #general" → 3.
 *  Discord only prefixes a count for MENTIONS/DMs; plain unread channels get a
 *  "•" prefix, which deliberately doesn't badge. */
export function parseDiscordUnreadCount(title: string): number {
  const m = /^\((\d+)\)/.exec(title.trim());
  return m ? parseInt(m[1], 10) : 0;
}

/** Guest zoom factor for a settled tile width. Discord's desktop layout is
 *  designed for ~1000px+ windows; stepping the zoom down keeps the channel
 *  sidebar, chat column, and composer usable inside a dashboard tile. */
export function zoomForWidth(width: number): number {
  if (width >= 900) return 1;
  if (width >= 700) return 0.9;
  if (width >= 550) return 0.85;
  return 0.75;
}

/** Compact-mode CSS injected on every dom-ready (inserted CSS doesn't survive
 *  reload/navigation). Discord's class names are build-hashed but keep their
 *  semantic prefix (e.g. `membersWrap_c8ffbb`), so match on the prefix.
 *  FAIL-SOFT by design: if Discord renames the prefix the selector matches
 *  nothing and the stock layout shows — nothing breaks. Selector verified
 *  against discord.com 2026-07; may rot with a Discord redesign.
 *  Deliberately does NOT hide the server rail or channel sidebar. */
export const DISCORD_COMPACT_CSS = '[class*="membersWrap"] { display: none !important; }';

/** Last width/height the host actually applied to the webview container. */
export interface DiscordHostSize {
  width: number;
  height: number;
}

/** How the host should adopt the live rect's size as the new settled size:
 *  'immediate' — right now; 'debounce' — after the ~120ms settle delay;
 *  'hold' — not at all (mid-gesture, or nothing changed). Position never
 *  settles — it is always applied live. */
export type DiscordSizeSettle = 'immediate' | 'debounce' | 'hold';

export interface DiscordHostStyleDecision {
  style: { left: number; top: number; width: number; height: number };
  settle: DiscordSizeSettle;
}

/** Host geometry for one frame. Position always tracks the live rect (moving
 *  a fixed div is cheap); width/height only ever take the SETTLED size —
 *  resizing the guest WebContents forces an async relayout per change, so
 *  per-mousemove sizes tear and thrash Discord's breakpoints. During grid
 *  gestures (`interacting`) the size is frozen outright; outside them, size
 *  changes settle via the caller's debounce.
 *  Exported for tests. */
export function nextHostStyle(
  rect: DiscordHostRect | null,
  interacting: boolean,
  settledSize: DiscordHostSize | null,
): DiscordHostStyleDecision {
  // Tile hidden → 0×0 instantly (NEVER display:none/unmount — guest dies).
  if (!rect) {
    return { style: { left: 0, top: 0, width: 0, height: 0 }, settle: 'immediate' };
  }
  // Nothing settled yet (first show, or re-show after hiding) — nothing to
  // freeze to, so take the live size in one step.
  if (!settledSize) {
    return {
      style: { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
      settle: 'immediate',
    };
  }
  const style = { left: rect.x, top: rect.y, width: settledSize.width, height: settledSize.height };
  if (interacting) return { style, settle: 'hold' };
  const sizeChanged = rect.width !== settledSize.width || rect.height !== settledSize.height;
  return { style, settle: sizeChanged ? 'debounce' : 'hold' };
}
