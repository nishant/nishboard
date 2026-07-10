import type { FastifyPluginAsync } from 'fastify';
import type { ClaudeChatRequestBody, ClaudeStatusData, ClaudeStreamEvent } from '@dash/shared';
import { claudeStatus, isSessionNotFoundError, spawnClaudeChat } from '../lib/claudeCli';
import { TtlCache } from '../lib/TtlCache';
import { HttpError } from '../lib/http';

// Status is probed at most once a minute — the discovery cache in claudeCli
// makes hits cheap once found, but a missing CLI would otherwise re-run
// `where`/`which` on every renderer poll.
const statusCache = new TtlCache<'status', ClaudeStatusData>(60_000);

// Single-flight: one streaming chat at a time. The CLI child is heavyweight
// and the widget UI only ever has one in-flight turn.
let activeChat: { kill(): void } | null = null;

// Mirror of app.ts's CORS origin list. reply.hijack() bypasses @fastify/cors
// entirely, so the SSE response must set Access-Control-Allow-Origin itself —
// only ever echoing an origin from this allowed set.
const ALLOWED_ORIGINS = new Set(['http://localhost:5173', 'file://', 'null']);

export const claudeRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/claude/status — CLI availability + version for the widget shell.
  fastify.get<{ Reply: ClaudeStatusData }>('/status', async (_req, reply) => {
    const cached = statusCache.get('status');
    if (cached) return reply.send(cached);
    const status = await claudeStatus();
    statusCache.set('status', status);
    return reply.send(status);
  });

  // POST /api/claude/chat — hijacked SSE stream of ClaudeStreamEvent frames.
  fastify.post<{ Body: ClaudeChatRequestBody }>(
    '/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1, maxLength: 50_000 },
            sessionId: { type: 'string', pattern: '^[A-Za-z0-9-]{8,64}$' },
          },
        },
      },
    },
    async (req, reply) => {
      if (activeChat) throw new HttpError(409, 'A Claude response is already streaming');

      const { message, sessionId } = req.body;

      // Past this point we own the raw socket — the central error handler and
      // @fastify/cors no longer apply.
      reply.hijack();
      const raw = reply.raw;
      const headers: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      const origin = req.headers.origin;
      if (origin !== undefined && ALLOWED_ORIGINS.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
      }
      raw.writeHead(200, headers);

      let ended = false;
      const send = (event: ClaudeStreamEvent): void => {
        if (ended) return;
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done' || event.type === 'error') {
          ended = true;
          raw.end();
        }
      };

      let retriedWithoutResume = false;
      let current: { kill(): void } | null = null;

      const start = (resumeId: string | undefined): void => {
        // A retry supersedes the failed first child — its late onExit must not
        // release the single-flight slot the retry now occupies.
        let superseded = false;
        const handle = spawnClaudeChat({
          message,
          sessionId: resumeId,
          onEvent: (event) => {
            // --resume pointed at a session this machine's CLI doesn't know
            // (wiped history, different box). Retry ONCE as a fresh chat — the
            // fresh child emits its own init frame, which the client stores as
            // the new sessionId.
            if (
              event.type === 'error' &&
              resumeId !== undefined &&
              !retriedWithoutResume &&
              isSessionNotFoundError(event.message)
            ) {
              retriedWithoutResume = true;
              superseded = true;
              start(undefined);
              return;
            }
            send(event);
          },
          onExit: () => {
            if (superseded) return;
            activeChat = null;
            if (!ended) {
              // Child gone without a done/error frame (killed on disconnect).
              ended = true;
              raw.end();
            }
          },
        });
        current = handle;
        activeChat = handle;
      };

      start(sessionId);

      // Reap the CLI child when the CLIENT disconnects mid-stream (Stop button,
      // widget unmount, app quit) — reap it instead of letting it stream into a
      // dead socket.
      //
      // CRITICAL: key this off the RESPONSE stream (`raw`), NOT `req.raw`. An
      // http.IncomingMessage emits 'close' the moment its request body is fully
      // read — which for a POST-with-body is immediately, long before the stream
      // finishes. Listening on `req.raw` therefore killed the child before
      // spawnClaudeChat even cleared its first `await`, so every chat produced
      // zero frames. The response socket only closes early on a real disconnect;
      // the `ended` guard skips the close that our own raw.end() triggers.
      raw.on('close', () => {
        if (!ended) current?.kill();
      });
    },
  );
};
