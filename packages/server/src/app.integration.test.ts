import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app';
import { stubFetch, textRes } from './test/fetchStub';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ logger: false });
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service endpoints', () => {
  it('GET /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/credentials/builtin returns key NAMES only (none baked in tests)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/credentials/builtin' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ keys: [] });
  });

  it('unknown routes 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(404);
  });
});

describe('central error handler — upstream status mapping', () => {
  // Exercised through the crypto route (unique id per case = unique cache key).
  const upstream = async (status: number, id: string) => {
    stubFetch([['api.coingecko.com', () => textRes(`upstream said ${status}`, status)]]);
    return app.inject({ method: 'GET', url: `/api/crypto?ids=${id}` });
  };

  it('passes actionable statuses through: 401, 403, 404', async () => {
    expect((await upstream(401, 'map-a')).statusCode).toBe(401);
    expect((await upstream(403, 'map-b')).statusCode).toBe(403);
    expect((await upstream(404, 'map-c')).statusCode).toBe(404);
  });

  it('maps everything else to 502 (500, 503, 418)', async () => {
    expect((await upstream(500, 'map-d')).statusCode).toBe(502);
    expect((await upstream(503, 'map-e')).statusCode).toBe(502);
    expect((await upstream(418, 'map-f')).statusCode).toBe(502);
  });

  it('HttpError thrown by a route keeps its exact status and message', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/crypto' }); // no ids → HttpError(400)
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('No coin ids provided');
  });
});
