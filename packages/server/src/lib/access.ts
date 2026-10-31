import { timingSafeEqual } from 'crypto';
import type { FastifyInstance } from 'fastify';

/** The only origins allowed to read responses. The packaged renderer is served
 *  from the app:// scheme (apps/main/src/appProtocol.ts); `pnpm dev` serves it
 *  from Vite. `null` and `file://` are gone on purpose: a sandboxed iframe on
 *  any web page sends `Origin: null`. The hijacked SSE routes (claude, discord)
 *  and the inbox guard read this same set, since @fastify/cors never runs there. */
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set(['app://nishboard', 'http://localhost:5173']);

/** Routes that answer without the bearer token, matched on the route pattern
 *  (never the raw URL, which a percent-escape can disguise). Iframe embeds and
 *  OAuth redirects are navigations, which cannot carry an Authorization
 *  header; each serves only a player page or finishes a flow the user started. */
const OPEN_ROUTES: ReadonlySet<string> = new Set([
  '/health',
  '/api/youtube/embed',
  '/api/twitch/embed',
  '/api/weather/radar-embed',
  '/api/spotify/callback',
  '/api/youtube/callback',
  '/api/twitch/callback',
  '/api/calendar/callback',
]);

/** Host headers the server answers. A DNS-rebinding page reaches 127.0.0.1
 *  under its own host name, so it fails here before anything else runs. */
export function allowedHosts(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

function tokenMatches(expected: Buffer, header: string | undefined): boolean {
  const presented = /^Bearer (\S+)$/.exec(header ?? '')?.[1];
  if (!presented) return false;
  const got = Buffer.from(presented);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** One onRequest hook in front of every route: an allowed Host, then the
 *  per-launch bearer token from the Electron main process on everything except
 *  OPEN_ROUTES. Anything that matched no route needs the token too, so a new
 *  route is protected by default. CORS preflights carry no Authorization
 *  header by spec; @fastify/cors answers them with the origin list above. */
export function registerAccessGuard(server: FastifyInstance, opts: { token: string; port: number }): void {
  const expected = Buffer.from(opts.token);
  const hosts = allowedHosts(opts.port);
  server.addHook('onRequest', async (req, reply) => {
    if (!hosts.has((req.headers.host ?? '').toLowerCase())) {
      return reply.code(403).send({ error: 'Forbidden host.' });
    }
    if (req.method === 'OPTIONS') return;
    const route = req.routeOptions.url;
    if ((req.method === 'GET' || req.method === 'HEAD') && route !== undefined && OPEN_ROUTES.has(route)) return;
    if (tokenMatches(expected, req.headers.authorization)) return;
    return reply.code(401).send({ error: 'Not authenticated.' });
  });
}
