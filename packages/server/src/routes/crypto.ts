import type { FastifyPluginAsync } from 'fastify';
import type { CryptoData, CryptoCoinData } from '@dash/shared';
import { fetchJson, HttpError, UpstreamError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';
import { cred } from '../lib/env';

// CoinGecko /coins/markets — price, 24h change, and the 7d sparkline in ONE
// call. Demo tier (free, registered key): 30 req/min, 10k/month via
// x-cg-demo-api-key; keyless works but is aggressively throttled.
const TTL_MS = 4 * 60 * 1000; // just under the renderer's 5-min poll
const cache = new TtlCache<string, CryptoData>(TTL_MS);

const MAX_IDS = 25;
const ID_RE = /^[a-z0-9-]{1,60}$/;

interface GeckoMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  market_cap: number | null;
  sparkline_in_7d?: { price?: number[] };
}

/** 7d hourly sparkline is ~168 points — every 4th is plenty for a tile chart. */
function downsample(points: number[], step = 4): number[] {
  return points.filter((_, i) => i % step === 0);
}

async function fetchMarkets(ids: string[]): Promise<CryptoData> {
  const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
  url.searchParams.set('vs_currency', 'usd');
  url.searchParams.set('ids', ids.join(','));
  url.searchParams.set('sparkline', 'true');
  url.searchParams.set('price_change_percentage', '24h');
  url.searchParams.set('per_page', String(MAX_IDS));

  const key = cred('COINGECKO_API_KEY');
  const rows = await fetchJson<GeckoMarket[]>(
    url.toString(),
    key ? { headers: { 'x-cg-demo-api-key': key } } : undefined,
    { label: 'CoinGecko' },
  );

  // Preserve the watchlist's order — CoinGecko returns market-cap order.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const coins: CryptoCoinData[] = ids
    .map((id) => byId.get(id))
    .filter((r): r is GeckoMarket => r != null)
    .map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      image: r.image,
      priceUsd: r.current_price ?? 0,
      change24hPercent: r.price_change_percentage_24h ?? 0,
      marketCapUsd: r.market_cap ?? 0,
      sparkline7d: downsample(r.sparkline_in_7d?.price ?? []),
    }));
  return { coins, updatedAt: new Date().toISOString() };
}

export const cryptoRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { ids?: string }; Reply: CryptoData | { error: string } }>(
    '/',
    async (req, reply) => {
      const ids = (req.query.ids ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => ID_RE.test(s))
        .slice(0, MAX_IDS);
      if (ids.length === 0) throw new HttpError(400, 'No coin ids provided');

      const key = [...ids].sort().join(',');
      const cached = cache.get(key);
      if (cached) return reply.send(cached);

      try {
        const data = await fetchMarkets(ids);
        cache.set(key, data);
        return reply.send(data);
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 429) {
          throw new HttpError(429, 'CoinGecko rate limit hit — data resumes in a minute. An API key in Settings → Developer raises the limit.');
        }
        throw err;
      }
    },
  );
};
