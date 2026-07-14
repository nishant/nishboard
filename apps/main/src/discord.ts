import { app, desktopCapturer, session, shell } from 'electron';
import type { DesktopCapturerSource, WebContents } from 'electron';
import { randomUUID } from 'crypto';
import type { DiscordScreenShareRequestData, DiscordScreenShareSourceData, IpcChannels } from '@dash/shared';

// The Discord widget embeds the REAL discord.com web app in a <webview> on a
// dedicated persist:discord partition (login survives restarts; nothing shares
// the default session). This module owns all main-side plumbing for it:
//   • partition session setup — clean Chrome UA + permission handlers
//   • getDisplayMedia interception → in-widget screen-share picker (the
//     clipboard-poller lifecycle pattern: a renderer subscribes only while the
//     widget is mounted)
//   • <webview> attach guards — webviewTag is enabled window-wide, so every
//     attach is validated here: discord.com only, never a preload/node access.

const DISCORD_PARTITION = 'persist:discord';
const SHARE_REQUEST_TIMEOUT_MS = 60_000;

/** Exported for tests. Full clean-Chrome UA for the discord partition. Merely
 *  stripping the Electron token (default-session treatment) is NOT enough —
 *  the app-name token (`Nishboard/x.y.z`) remains and trips Discord's
 *  unsupported-browser wall. */
export function discordUserAgent(platform: NodeJS.Platform, chromeVersion: string): string {
  const os = platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : 'Windows NT 10.0; Win64; x64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

/** Exported for tests. True for https URLs on discord.com or a subdomain.
 *  Parsed with `new URL()` — a prefix check would pass
 *  `https://discord.com.evil.com`. */
export function isAllowedDiscordUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'discord.com' || url.hostname.endsWith('.discord.com'))
    );
  } catch {
    return false;
  }
}

// Everything Discord web legitimately asks for: mic/cam (voice), screen share,
// desktop notifications, copy-on-click, fullscreen video.
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'display-capture',
  'notifications',
  'clipboard-sanitized-write',
  'fullscreen',
]);

/** Exported for tests. Permission policy for the discord partition — both the
 *  async request handler AND the sync check handler delegate here (Discord
 *  gates notifications on the synchronous `Notification.permission` read, so
 *  the two must agree). */
export function decideDiscordPermission(permission: string, requestingUrl: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isAllowedDiscordUrl(requestingUrl);
}

/** Structural stand-in for DesktopCapturerSource so tests can pass plain
 *  fakes (NativeImage is structurally assignable). Exported for tests. */
export interface CapturerSourceLike {
  id: string;
  name: string;
  thumbnail: { toDataURL(): string };
  /** Typed non-null by electron but null at runtime for screens / when
   *  fetchWindowIcons is off. */
  appIcon?: { toDataURL(): string; isEmpty(): boolean } | null;
}

/** Exported for tests. Map capturer sources to the renderer-safe shape —
 *  `data:` URIs only (launcher-icon convention), never paths/handles. */
export function serializeShareSources(sources: CapturerSourceLike[]): DiscordScreenShareSourceData[] {
  return sources.map((s) => {
    const appIcon = s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : undefined;
    return {
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.toDataURL(),
      ...(appIcon ? { appIcon } : {}),
    };
  });
}

// ── Screen-share picker state (module singletons, clipboardHistory-style) ────

interface PendingShareRequest {
  requestId: string;
  sources: Map<string, DesktopCapturerSource>;
  audioRequested: boolean;
  callback: (streams: Electron.Streams) => void;
  timer: NodeJS.Timeout;
}

let subscriber: WebContents | null = null;
let pending: PendingShareRequest | null = null;
// Monotonic guard: a new getDisplayMedia while the previous one's getSources()
// is still in flight must not let the stale request install itself as pending.
let activeToken: string | null = null;

function denyPending(): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.callback({});
  pending = null;
}

/** Renderer hosting the Discord widget subscribes while mounted (main window
 *  or popout — whichever holds the widget). No subscriber → shares auto-deny. */
export function setDiscordScreenShareWatch(enabled: boolean, sender: WebContents): void {
  if (enabled) {
    subscriber = sender;
  } else if (subscriber === sender) {
    // Only the current subscriber may unsubscribe — a stale unmount from a
    // superseded window must not clobber the live one.
    subscriber = null;
    denyPending();
  }
}

/** Answer from the in-widget picker. Stale/unknown requestIds are no-ops;
 *  null sourceId (Cancel/timeout) denies. */
export function selectDiscordScreenShareSource(requestId: string, sourceId: string | null): void {
  if (!pending || pending.requestId !== requestId) return;
  const { callback, sources, audioRequested, timer } = pending;
  clearTimeout(timer);
  pending = null;
  const source = sourceId === null ? undefined : sources.get(sourceId);
  if (!source) {
    callback({}); // getDisplayMedia rejects with NotAllowedError
    return;
  }
  callback({
    video: source,
    // Windows-only: Chromium loopback system-audio capture. macOS has no
    // loopback source — shares are video-only there.
    ...(audioRequested && process.platform === 'win32' ? { audio: 'loopback' as const } : {}),
  });
}

/** Clear the persist:discord partition — logs the webview out. Other widgets
 *  (default session) are untouched. */
export async function signOutDiscord(): Promise<void> {
  const ses = session.fromPartition(DISCORD_PARTITION);
  await ses.clearStorageData();
  await ses.clearCache();
}

/** Set up the persist:discord session. Call from whenReady BEFORE
 *  createWindow() so the partition exists configured when the webview attaches. */
export function initDiscordSession(): void {
  const ses = session.fromPartition(DISCORD_PARTITION);
  ses.setUserAgent(discordUserAgent(process.platform, process.versions.chrome));

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(decideDiscordPermission(permission, details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) =>
    decideDiscordPermission(permission, requestingOrigin));

  // Discord web calls getDisplayMedia for screen share — route it through the
  // in-widget picker instead of Chromium's (absent) default UI.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    denyPending(); // a new request supersedes any unanswered one
    if (!subscriber || subscriber.isDestroyed()) {
      callback({});
      return;
    }
    const requestId = randomUUID();
    activeToken = requestId;
    desktopCapturer
      .getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      })
      .then((sources) => {
        if (activeToken !== requestId || !subscriber || subscriber.isDestroyed()) {
          callback({}); // superseded or widget unmounted mid-enumeration
          return;
        }
        pending = {
          requestId,
          sources: new Map(sources.map((s) => [s.id, s])),
          audioRequested: request.audioRequested,
          callback,
          timer: setTimeout(() => {
            if (pending?.requestId === requestId) denyPending();
          }, SHARE_REQUEST_TIMEOUT_MS),
        };
        const payload: DiscordScreenShareRequestData = {
          requestId,
          sources: serializeShareSources(sources),
        };
        subscriber.send('discord:screenshare-request' satisfies IpcChannels, payload);
      })
      .catch(() => callback({}));
  });
}

/** Guard every <webview> attach app-wide. webviewTag is enabled on the main +
 *  popout windows, so this is the actual security boundary: only discord.com
 *  may load, and never with a preload or node access. Also wires the guest's
 *  own window/navigation policy (the embedder's handlers don't govern it).
 *  Call from whenReady BEFORE createWindow(). */
export function registerWebviewGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      if (!isAllowedDiscordUrl(params.src ?? '')) {
        event.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
    });

    if (contents.getType() === 'webview') {
      // target=_blank / window.open inside Discord (chat links, invites) →
      // system browser; never an Electron window.
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//i.test(url)) void shell.openExternal(url);
        return { action: 'deny' };
      });
      // Rare top-frame navigations off discord.com also go to the browser.
      contents.on('will-navigate', (event, url) => {
        if (isAllowedDiscordUrl(url)) return;
        event.preventDefault();
        if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      });
    }
  });
}
