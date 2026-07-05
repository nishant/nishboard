import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CryptoData } from '@dash/shared';
import { buildServer } from '../app';
import { jsonRes, stubFetch, textRes } from '../test/fetchStub';

// NOTE: module-level TTL cache is keyed by the sorted id set — each test uses
// a distinct id set to dodge cross-test cache hits.

function gecko(id: string, price: number | null, spark: number[] = []): Record<string, unknown> {
  return {
    id,
    symbol: id.slice(0, 3),
    name: id[0].toUpperCase() + id.slice(1),
    image: `https://img.test/${id}.png`,
    current_price: price,
    price_change_percentage_24h: 2.5,
    market_cap: 1000,
    sparkline_in_7d: { price: spark },
  };
}

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

describe('GET /api/crypto', () => {
  it('400s when no valid ids are provided', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/crypto' })).statusCode).toBe(400);
    // Ids failing the [a-z0-9-] pattern are filtered — all-invalid = none provided.
    expect((await app.inject({ method: 'GET', url: '/api/crypto?ids=B$TC,,%20' })).statusCode).toBe(400);
  });

  it('preserves the watchlist order even though CoinGecko returns market-cap order', async () => {
    const spark = Array.from({ length: 168 }, (_, i) => i);
    stubFetch([
      // CoinGecko replies big-cap first: bitcoin, ethereum, dogecoin.
      ['api.coingecko.com/api/v3/coins/markets', () =>
        jsonRes([gecko('bitcoin', 100_000, spark), gecko('ethereum', 4000), gecko('dogecoin', 0.1)])],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/crypto?ids=dogecoin,bitcoin,ethereum' });
    expect(res.statusCode).toBe(200);
    const data = res.json<CryptoData>();
    expect(data.coins.map((c) => c.id)).toEqual(['dogecoin', 'bitcoin', 'ethereum']);
    // 7d sparkline is downsampled (every 4th of 168 = 42 points).
    expect(data.coins[1].sparkline7d).toHaveLength(42);
    expect(data.coins[1].priceUsd).toBe(100_000);
  });

  it('nulls from CoinGecko become 0s, and unknown ids are dropped', async () => {
    stubFetch([
      ['api.coingecko.com/api/v3/coins/markets', () => jsonRes([gecko('cardano', null)])],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/crypto?ids=cardano,not-a-real-coin' });
    const data = res.json<CryptoData>();
    expect(data.coins).toHaveLength(1);
    expect(data.coins[0].priceUsd).toBe(0);
  });

  it('maps a CoinGecko 429 to a friendly rate-limit error', async () => {
    stubFetch([
      ['api.coingecko.com/api/v3/coins/markets', () => textRes('Throttled', 429)],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/crypto?ids=solana' });
    expect(res.statusCode).toBe(429);
    expect(res.json<{ error: string }>().error).toContain('rate limit');
  });
});
