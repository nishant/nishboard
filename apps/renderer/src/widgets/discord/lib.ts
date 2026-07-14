// NOTE: the <webview> JSX intrinsic itself comes from @types/react
// (WebViewHTMLAttributes — allowpopups/partition/src/webpreferences are all
// typed there); only the runtime method surface + event payloads we drive are
// declared here. The renderer deliberately has no electron types dependency.

/** The subset of Electron's WebviewTag API the Discord widget uses. */
export interface DiscordWebviewElement extends HTMLElement {
  reload(): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
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
