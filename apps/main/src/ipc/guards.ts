// Pure URL and id checks for the IPC handlers in ./index.ts. They live here so
// they can be unit-tested without Electron. Every argument is `unknown`: it
// comes from the renderer, so a non-string must be rejected, not thrown on.

export type AuthService = 'spotify' | 'twitch' | 'youtube' | 'google';

// The auth URL is always built by our own server route, so only the identity
// provider's own host is a legitimate target.
const AUTH_PREFIXES: Record<AuthService, string> = {
  spotify: 'https://accounts.spotify.com/',
  twitch: 'https://id.twitch.tv/',
  youtube: 'https://accounts.google.com/',
  google: 'https://accounts.google.com/',
};

/** http(s) links the OS browser may open (app:open-external). */
export function isAllowedExternalUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/** Whether `url` is a legitimate OAuth start URL for `service`. */
export function isAuthUrl(service: AuthService, url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(AUTH_PREFIXES[service]);
}

/** Pop-out ids are renderer WidgetIds (lowercase slugs). */
export function isValidPopoutId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z]{2,20}$/.test(id);
}
