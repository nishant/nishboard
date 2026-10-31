import { net, protocol } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';

/** The packaged renderer's origin. It used to load from file://, whose Origin
 *  header is `null`, and the local server had to allow `null`, which is also
 *  what a sandboxed iframe on any web page sends. A standard, secure custom
 *  scheme gives the renderer an origin nothing else can claim. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'nishboard';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** A blank page on the app origin, for storageMigration.ts to write into
 *  localStorage before the real renderer runs. */
export const BLANK_PATH = '/__blank';

/** Must run before app 'ready'. `standard` gives the scheme real origins and
 *  relative URLs, `secure` makes it a secure context, `corsEnabled` lets the
 *  Vite build's `<script type="module" crossorigin>` load, `supportFetchAPI`
 *  and `stream` cover fetch and media. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/** The file under `root` that an app:// URL names, or null when the URL is not
 *  ours or climbs out of `root`. `/` serves index.html.
 *  Exported for tests. */
export function resolveAppPath(root: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (rel === '/' || rel === '') rel = '/index.html';
  const base = path.resolve(root);
  const file = path.resolve(base, `.${rel}`);
  return file.startsWith(base + path.sep) ? file : null;
}

/** Serve app://nishboard/* from the built renderer. Call after app 'ready'. */
export function handleAppProtocol(root: string): void {
  protocol.handle(APP_SCHEME, async (req) => {
    if (new URL(req.url).pathname === BLANK_PATH) {
      return new Response('<!doctype html><title></title>', { headers: { 'content-type': 'text/html' } });
    }
    const file = resolveAppPath(root, req.url);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** The renderer's URL, with `?widget=<id>` for a popout. */
export function appUrl(query?: Record<string, string>): string {
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  return `${APP_ORIGIN}/index.html${qs}`;
}
