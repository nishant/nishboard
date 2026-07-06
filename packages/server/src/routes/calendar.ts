import type { FastifyPluginAsync } from 'fastify';
import type { CalendarAuthStatus, CalendarEventData, CalendarEventsData } from '@dash/shared';
import crypto from 'crypto';
import { fetchJson, HttpError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';
import { UserTokenStore, rethrowRefreshFailure } from '../lib/userTokenStore';
import type { StoredUserTokens } from '../lib/userTokenStore';

const BASE = 'https://www.googleapis.com/calendar/v3';

// ── User OAuth (authorization-code grant, loopback redirect) ──────────────────
// Reuses the SAME Google Cloud OAuth client as YouTube (YOUTUBE_CLIENT_ID /
// YOUTUBE_CLIENT_SECRET) — Calendar just needs its own scope, redirect URI and
// consent. This EXACT redirect URI must be registered on the OAuth client in
// Google Cloud console (alongside the YouTube one). Tokens are stored in a
// separate file, so connecting/disconnecting Calendar never touches YouTube's
// session (and vice versa). access_type=offline + prompt=consent forces a
// refresh_token on every connect (Google only returns one on consent).
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const CAL_REDIRECT_URI = 'http://localhost:7432/api/calendar/callback';
const CAL_USER_SCOPES = 'https://www.googleapis.com/auth/calendar.events';

async function refreshCalendarToken(refreshToken: string): Promise<StoredUserTokens> {
  // Without client credentials the token endpoint would 4xx and look like a
  // dead grant — refuse to even try, so the stored session survives until
  // credentials are configured again.
  if (!cred('YOUTUBE_CLIENT_ID') || !cred('YOUTUBE_CLIENT_SECRET')) {
    throw new HttpError(503, 'Google client credentials not configured — cannot refresh token');
  }
  try {
    const data = await fetchJson<{ access_token: string; expires_in: number }>(
      GOOGLE_TOKEN,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: cred('YOUTUBE_CLIENT_ID'),
          client_secret: cred('YOUTUBE_CLIENT_SECRET'),
        }),
      },
      { label: 'Google Calendar token refresh' },
    );
    return {
      access_token: data.access_token,
      refresh_token: refreshToken, // Google does not rotate refresh tokens
      expires_at: Date.now() + data.expires_in * 1000,
    };
  } catch (err) {
    rethrowRefreshFailure(err);
  }
}

const userTokens = new UserTokenStore('google_calendar_tokens.json', refreshCalendarToken);

interface PendingAuth { state: string; expiresAt: number; }
let pendingAuth: PendingAuth | null = null;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD → local midnight Date (RFC3339 timeMin/timeMax come from
 *  .toISOString() on these — the Calendar API rejects bare dates there). */
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Local Date → YYYY-MM-DD (all-day insert bodies). */
function toIsoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Google Calendar v3 event resource — only the fields we read.
interface GoogleEventItem {
  id: string;
  summary?: string;
  location?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
}

function mapEvent(item: GoogleEventItem): CalendarEventData {
  // All-day events carry start.date (no dateTime); timed events the reverse.
  const allDay = Boolean(item.start?.date);
  const ev: CalendarEventData = {
    id: item.id,
    title: item.summary ?? '(no title)',
    start: item.start?.dateTime ?? item.start?.date ?? '',
    end: item.end?.dateTime ?? item.end?.date ?? '',
    allDay,
  };
  if (item.location) ev.location = item.location;
  return ev;
}

// One entry per visible widget range; cleared on insert/logout so a quick-add
// shows up immediately instead of after the TTL.
const EVENTS_CACHE = new TtlCache<string, CalendarEventsData>(5 * 60 * 1000);

export const calendarRoutes: FastifyPluginAsync = async (fastify) => {

  // ── User OAuth ──────────────────────────────────────────────────────────────

  // GET /api/calendar/auth-url — builds the Google authorize URL; the renderer
  // opens it via the guarded google:open-auth IPC channel.
  fastify.get('/auth-url', async (_req, reply) => {
    if (!cred('YOUTUBE_CLIENT_ID') || !cred('YOUTUBE_CLIENT_SECRET')) {
      throw new HttpError(503, 'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET not configured');
    }
    const state = crypto.randomBytes(16).toString('hex');
    pendingAuth = { state, expiresAt: Date.now() + 10 * 60 * 1000 };
    const params = new URLSearchParams({
      client_id: cred('YOUTUBE_CLIENT_ID'),
      redirect_uri: CAL_REDIRECT_URI,
      response_type: 'code',
      scope: CAL_USER_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return reply.send({ url: `${GOOGLE_AUTH}?${params.toString()}` });
  });

  // GET /api/calendar/callback — code exchange.
  fastify.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) {
        return reply.type('text/html')
          .send(`<html><body><h2>Google auth denied: ${escapeHtml(error)}</h2><p>You can close this tab.</p></body></html>`);
      }
      if (!code || !state || !pendingAuth || pendingAuth.state !== state || Date.now() > pendingAuth.expiresAt) {
        pendingAuth = null;
        return reply.code(400).type('text/html')
          .send('<html><body><h2>Invalid or expired auth request.</h2><p>Try connecting again.</p></body></html>');
      }
      try {
        const data = await fetchJson<{ access_token: string; refresh_token?: string; expires_in: number }>(
          GOOGLE_TOKEN,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              code,
              redirect_uri: CAL_REDIRECT_URI,
              client_id: cred('YOUTUBE_CLIENT_ID'),
              client_secret: cred('YOUTUBE_CLIENT_SECRET'),
            }),
          },
          { label: 'Google Calendar token exchange' },
        );
        // prompt=consent should always yield one; guard anyway (a re-consent
        // without it would leave us unable to refresh after ~1h).
        if (!data.refresh_token) throw new Error('Google returned no refresh_token — try connecting again');
        userTokens.store({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + data.expires_in * 1000,
        });
        pendingAuth = null;
        EVENTS_CACHE.clear();
        return reply.type('text/html')
          .send('<html><body><h2>Connected to Google Calendar!</h2><p>You can close this tab.</p></body></html>');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`[calendar] callback error: ${msg}`);
        return reply.code(502).type('text/html')
          .send(`<html><body><h2>Token exchange failed.</h2><pre>${escapeHtml(msg)}</pre></body></html>`);
      }
    },
  );

  // GET /api/calendar/auth-status
  fastify.get<{ Reply: CalendarAuthStatus }>('/auth-status', async (_req, reply) => {
    return reply.send({ authenticated: userTokens.authenticated });
  });

  // POST /api/calendar/logout
  fastify.post('/logout', async (_req, reply) => {
    userTokens.clear();
    EVENTS_CACHE.clear();
    return reply.code(204).send();
  });

  // ── Events ──────────────────────────────────────────────────────────────────

  // GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD (both inclusive).
  // singleEvents=true expands recurring events into instances — REQUIRED for
  // orderBy=startTime. timeMax is the local midnight AFTER `end` so the last
  // day is fully covered.
  fastify.get<{
    Querystring: { start?: string; end?: string };
    Reply: CalendarEventsData | { error: string };
  }>('/events', async (req, reply) => {
    const start = (req.query.start ?? '').trim();
    const end = (req.query.end ?? '').trim();
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
      throw new HttpError(400, 'start and end (YYYY-MM-DD) are required');
    }
    if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to Google Calendar' });

    const cacheKey = `${start}|${end}`;
    const cached = EVENTS_CACHE.get(cacheKey);
    if (cached) return reply.send(cached);

    const timeMin = parseLocalDate(start).toISOString();
    const endExclusive = parseLocalDate(end);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const timeMax = endExclusive.toISOString();

    const token = await userTokens.getValidToken();
    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      timeMin,
      timeMax,
    });
    const d = await fetchJson<{ items?: GoogleEventItem[] }>(
      `${BASE}/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
      { label: 'Google Calendar events' },
    );

    const data: CalendarEventsData = { events: (d.items ?? []).map(mapEvent) };
    EVENTS_CACHE.set(cacheKey, data);
    return reply.send(data);
  });

  // POST /api/calendar/events — quick add on the primary calendar.
  // No time → all-day (Google's all-day end.date is EXCLUSIVE → date+1).
  // With time → timed event starting at local date+time, default 60 min.
  const addEventBody = {
    type: 'object',
    required: ['summary', 'date'],
    additionalProperties: false,
    properties: {
      summary: { type: 'string', minLength: 1, maxLength: 200 },
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
      durationMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
    },
  } as const;

  fastify.post<{
    Body: { summary: string; date: string; time?: string; durationMinutes?: number };
    Reply: CalendarEventData | { error: string };
  }>(
    '/events',
    { schema: { body: addEventBody } },
    async (req, reply) => {
      if (!userTokens.authenticated) return reply.code(401).send({ error: 'Not connected to Google Calendar' });
      const { summary, date, time, durationMinutes } = req.body;

      let body: {
        summary: string;
        start: { date: string } | { dateTime: string };
        end: { date: string } | { dateTime: string };
      };
      if (time) {
        const startD = parseLocalDate(date);
        const [hh, mm] = time.split(':').map(Number);
        startD.setHours(hh, mm, 0, 0);
        const endD = new Date(startD.getTime() + (durationMinutes ?? 60) * 60 * 1000);
        body = {
          summary,
          start: { dateTime: startD.toISOString() },
          end: { dateTime: endD.toISOString() },
        };
      } else {
        const endD = parseLocalDate(date);
        endD.setDate(endD.getDate() + 1);
        body = {
          summary,
          start: { date },
          end: { date: toIsoDate(endD) }, // exclusive
        };
      }

      const token = await userTokens.getValidToken();
      const created = await fetchJson<GoogleEventItem>(
        `${BASE}/calendars/primary/events`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        { label: 'Google Calendar insert' },
      );

      EVENTS_CACHE.clear();
      return reply.send(mapEvent(created));
    },
  );
};
