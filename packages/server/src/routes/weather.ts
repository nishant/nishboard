import type { FastifyPluginAsync } from 'fastify';
import type { WeatherData } from '@dash/shared';

const TTL_MS = 15 * 60 * 1000;
const GEO_TTL_MS = 60 * 60 * 1000;

// ── Geolocation ───────────────────────────────────────────────────────────────

interface Geo { lat: number; lon: number; timezone: string; name: string; region: string; }

// IP geolocation — single shared slot (everyone on auto resolves to the same place)
let ipGeo: { data: Geo; at: number } | null = null;

async function getGeoFromIp(): Promise<Geo> {
  if (ipGeo && Date.now() - ipGeo.at < GEO_TTL_MS) return ipGeo.data;
  // ip-api.com: free, no key, 45 req/min — more than enough (we cache for an hour)
  const res = await fetch('http://ip-api.com/json/?fields=lat,lon,timezone,city,regionName');
  if (!res.ok) throw new Error(`ip-api error ${res.status}`);
  const j = await res.json() as { lat: number; lon: number; timezone: string; city: string; regionName: string };
  const data: Geo = { lat: j.lat, lon: j.lon, timezone: j.timezone, name: j.city, region: j.regionName };
  ipGeo = { data, at: Date.now() };
  return data;
}

// ZIP → lat/lon via zippopotam.us (free, no key). Cached per-ZIP.
const zipGeoCache = new Map<string, { data: Geo; at: number }>();

async function getGeoFromZip(zip: string): Promise<Geo> {
  const cached = zipGeoCache.get(zip);
  if (cached && Date.now() - cached.at < GEO_TTL_MS) return cached.data;
  const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!res.ok) throw new Error(`Unknown ZIP code "${zip}"`);
  const j = await res.json() as {
    places?: { 'place name': string; 'state abbreviation': string; latitude: string; longitude: string }[];
  };
  const p = j.places?.[0];
  if (!p) throw new Error(`Unknown ZIP code "${zip}"`);
  const data: Geo = {
    lat: Number(p.latitude),
    lon: Number(p.longitude),
    // No timezone from zippopotam — let Open-Meteo infer it from the coordinates.
    timezone: 'auto',
    name: p['place name'],
    region: p['state abbreviation'],
  };
  zipGeoCache.set(zip, { data, at: Date.now() });
  return data;
}

// ── Weather fetch ─────────────────────────────────────────────────────────────

const weatherCache = new Map<string, { data: WeatherData; at: number }>();

function buildUrl(lat: number, lon: number, timezone: string): string {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
    'precipitation_probability', 'weathercode', 'windspeed_10m', 'uv_index',
  ].join(','));
  url.searchParams.set('hourly', [
    'temperature_2m', 'precipitation_probability', 'weathercode',
  ].join(','));
  url.searchParams.set('daily', [
    'weathercode', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_probability_max',
  ].join(','));
  url.searchParams.set('temperature_unit', 'fahrenheit');
  url.searchParams.set('windspeed_unit', 'mph');
  url.searchParams.set('timezone', timezone);
  url.searchParams.set('forecast_days', '6');
  return url.toString();
}

async function fetchWeather(geo: Geo): Promise<WeatherData> {
  const res = await fetch(buildUrl(geo.lat, geo.lon, geo.timezone));
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);

  const raw = await res.json() as {
    current: {
      time: string;
      temperature_2m: number;
      apparent_temperature: number;
      relative_humidity_2m: number;
      precipitation_probability: number;
      weathercode: number;
      windspeed_10m: number;
      uv_index: number;
    };
    hourly: {
      time: string[];
      temperature_2m: number[];
      precipitation_probability: number[];
      weathercode: number[];
    };
    daily: {
      time: string[];
      weathercode: number[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: number[];
    };
  };

  const nowHour = raw.current.time.slice(0, 13);
  const hourIdx = raw.hourly.time.findIndex((t) => t.startsWith(nowHour));
  const startIdx = hourIdx >= 0 ? hourIdx : 0;

  return {
    current: {
      temp: Math.round(raw.current.temperature_2m),
      feelsLike: Math.round(raw.current.apparent_temperature),
      humidity: raw.current.relative_humidity_2m,
      windSpeed: Math.round(raw.current.windspeed_10m),
      uvIndex: raw.current.uv_index,
      precipChance: raw.current.precipitation_probability,
      weatherCode: raw.current.weathercode,
    },
    hourly: raw.hourly.time.slice(startIdx, startIdx + 12).map((time, i) => ({
      time,
      temp: Math.round(raw.hourly.temperature_2m[startIdx + i]),
      precipChance: raw.hourly.precipitation_probability[startIdx + i],
      weatherCode: raw.hourly.weathercode[startIdx + i],
    })),
    daily: raw.daily.time.slice(0, 5).map((date, i) => ({
      date,
      tempMax: Math.round(raw.daily.temperature_2m_max[i]),
      tempMin: Math.round(raw.daily.temperature_2m_min[i]),
      precipChance: raw.daily.precipitation_probability_max[i],
      weatherCode: raw.daily.weathercode[i],
    })),
    location: { name: geo.name, region: geo.region || undefined },
    fetchedAt: new Date().toISOString(),
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const weatherRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { zip?: string }; Reply: WeatherData | { error: string } }>(
    '/',
    async (req, reply) => {
      const rawZip = (req.query.zip ?? '').trim();
      const zip = /^\d{5}$/.test(rawZip) ? rawZip : '';
      const key = zip || 'auto';

      const cached = weatherCache.get(key);
      if (cached && Date.now() - cached.at < TTL_MS) return reply.send(cached.data);

      try {
        const geo = zip ? await getGeoFromZip(zip) : await getGeoFromIp();
        const data = await fetchWeather(geo);
        weatherCache.set(key, { data, at: Date.now() });
        return reply.send(data);
      } catch (err) {
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Weather lookup failed' });
      }
    },
  );
};
