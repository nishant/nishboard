import type { FastifyPluginAsync } from 'fastify';
import type {
  InboxFeedData, InboxItemData, InboxListData, InboxSnoozeRequestBody, InboxHandleAllRequestBody,
} from '@dash/shared';
import { HttpError } from '../lib/http';
import { ALLOWED_ORIGINS } from '../lib/access';
import {
  inboxRequest, InboxOfflineError, InboxNoPasswordError, InboxBadPasswordError, InboxUpstreamError,
} from '../lib/inboxClient';

// Proxy to the local Inbox service. Every proxied path piece is validated here
// (enum view, numeric id, regex source/cursor) — no renderer-supplied path
// segments or headers reach the inbox, and /ingest/* is never called.

const VIEWS = new Set(['open', 'snoozed', 'handled']);
const SOURCE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CURSOR_RE = /^[A-Za-z0-9_\-=.:]{1,200}$/;
const ID_RE = /^\d{1,15}$/;
const ACTION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// The inbox waits up to 8s on an action's target; leave headroom past that.
const ACTION_TIMEOUT_MS = 10_000;
const PASSTHROUGH = new Set([400, 404, 409, 429]);

function upstreamError(err: InboxUpstreamError): HttpError {
  return new HttpError(PASSTHROUGH.has(err.status) ? err.status : 502, err.message);
}

function mutationError(err: unknown): unknown {
  if (err instanceof InboxOfflineError) return new HttpError(503, 'Inbox is not reachable.');
  if (err instanceof InboxNoPasswordError) {
    return new HttpError(400, 'Add the Inbox password in Settings → Developer.');
  }
  if (err instanceof InboxBadPasswordError) return new HttpError(401, 'The Inbox password was not accepted.');
  if (err instanceof InboxUpstreamError) return upstreamError(err);
  return err;
}

async function mutate<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  try {
    return await inboxRequest<T>('POST', path, body, timeoutMs);
  } catch (err) {
    throw mutationError(err);
  }
}

function checkId(id: string): string {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Not found.');
  return id;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function hostName(host: string): string {
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
}

export const inboxRoutes: FastifyPluginAsync = async (app) => {
  // CSRF + DNS-rebinding guard. The proxy attaches the real inbox session
  // cookie, so the inbox's own Origin/Host defenses must be re-applied here.
  app.addHook('onRequest', async (req) => {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!LOOPBACK_HOSTS.has(hostName(host))) throw new HttpError(403, 'Forbidden host.');
    const origin = req.headers.origin;
    if (origin !== undefined && !ALLOWED_ORIGINS.has(origin)) throw new HttpError(403, 'Forbidden origin.');
    // Non-JSON POSTs are "simple" cross-site requests (no preflight) — refuse.
    if (req.method === 'POST' && !(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new HttpError(415, 'JSON body required.');
    }
  });

  app.get<{ Querystring: { view?: string; source?: string; cursor?: string; limit?: string } }>(
    '/items',
    async (req): Promise<InboxFeedData> => {
      const view = req.query.view || 'open';
      if (!VIEWS.has(view)) throw new HttpError(400, 'Bad view.');
      const source = req.query.source ?? '';
      if (source && !SOURCE_RE.test(source)) throw new HttpError(400, 'Bad source.');
      const cursor = req.query.cursor ?? '';
      if (cursor && !CURSOR_RE.test(cursor)) throw new HttpError(400, 'Bad cursor.');
      let limit = 50;
      if (req.query.limit !== undefined && req.query.limit !== '') {
        const n = Number(req.query.limit);
        if (!Number.isInteger(n) || n < 1 || n > 100) throw new HttpError(400, 'Bad limit.');
        limit = n;
      }
      const qs = new URLSearchParams({ view, limit: String(limit) });
      if (source) qs.set('source', source);
      if (cursor) qs.set('cursor', cursor);
      try {
        const list = await inboxRequest<InboxListData>('GET', `/items?${qs.toString()}`);
        return { state: 'ok', list };
      } catch (err) {
        if (err instanceof InboxOfflineError) return { state: 'offline' };
        if (err instanceof InboxNoPasswordError) return { state: 'no-password' };
        if (err instanceof InboxBadPasswordError) return { state: 'bad-password' };
        if (err instanceof InboxUpstreamError) throw upstreamError(err);
        throw err;
      }
    },
  );

  app.post<{ Body: InboxHandleAllRequestBody | undefined }>('/items/handle-all', async (req) => {
    const source = req.body?.source;
    if (source !== undefined && source !== '') {
      if (typeof source !== 'string' || !SOURCE_RE.test(source)) throw new HttpError(400, 'Bad source.');
    }
    return mutate<{ count: number }>('/items/handle-all', source ? { source } : {});
  });

  app.post<{ Params: { id: string } }>('/items/:id/handle', async (req) =>
    mutate<InboxItemData>(`/items/${checkId(req.params.id)}/handle`, {}));

  app.post<{ Params: { id: string } }>('/items/:id/unhandle', async (req) =>
    mutate<InboxItemData>(`/items/${checkId(req.params.id)}/unhandle`, {}));

  app.post<{ Params: { id: string } }>('/items/:id/unsnooze', async (req) =>
    mutate<InboxItemData>(`/items/${checkId(req.params.id)}/unsnooze`, {}));

  app.post<{ Params: { id: string }; Body: InboxSnoozeRequestBody | undefined }>(
    '/items/:id/snooze',
    async (req) => {
      const id = checkId(req.params.id);
      const until = req.body?.until;
      if (typeof until !== 'string' || !Number.isFinite(Date.parse(until))) {
        throw new HttpError(400, 'Pick a snooze time.');
      }
      return mutate<InboxItemData>(`/items/${id}/snooze`, { until });
    },
  );

  // Producer-defined action (S5). The inbox runs its stored target; we only pass ids.
  // 200 + the updated item whether the target succeeded or not (see item.lastAction).
  app.post<{ Params: { id: string; actionId: string } }>('/items/:id/actions/:actionId', async (req) => {
    const id = checkId(req.params.id);
    if (!ACTION_ID_RE.test(req.params.actionId)) throw new HttpError(404, 'Not found.');
    return mutate<InboxItemData>(`/items/${id}/actions/${req.params.actionId}`, {}, ACTION_TIMEOUT_MS);
  });
};
