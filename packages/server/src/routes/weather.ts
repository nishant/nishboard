import type { FastifyPluginAsync } from 'fastify';
import type { WeatherData, WeatherAlert } from '@dash/shared';
import { fetchJson, HttpError } from '../lib/http';
import { TtlCache } from '../lib/TtlCache';

const TTL_MS = 15 * 60 * 1000;
const GEO_TTL_MS = 60 * 60 * 1000;

// ── Geolocation ───────────────────────────────────────────────────────────────

interface Geo { lat: number; lon: number; timezone: string; name: string; region: string; }

// IP geolocation — single shared slot (everyone on auto resolves to the same place)
let ipGeo: { data: Geo; at: number } | null = null;

async function getGeoFromIp(): Promise<Geo> {
  if (ipGeo && Date.now() - ipGeo.at < GEO_TTL_MS) return ipGeo.data;
  try {
    // ip-api.com: free, no key, 45 req/min — more than enough (we cache for an hour).
    // Request `status`/`message` so we catch the 200-but-failed case (e.g. reserved/private IP).
    const j = await fetchJson<{
      status: string; message?: string;
      lat: number; lon: number; timezone: string; city: string; regionName: string;
    }>('http://ip-api.com/json/?fields=status,message,lat,lon,timezone,city,regionName', undefined, {
      label: 'ip-api',
    });
    if (j.status !== 'success' || typeof j.lat !== 'number') {
      throw new Error(`ip-api: ${j.message ?? 'geolocation failed'}`);
    }
    const data: Geo = { lat: j.lat, lon: j.lon, timezone: j.timezone, name: j.city, region: j.regionName };
    ipGeo = { data, at: Date.now() };
    return data;
  } catch (err) {
    // Transient blip — serve the last-known location (even if stale) rather than error out.
    if (ipGeo) return ipGeo.data;
    throw err;
  }
}

// ZIP → lat/lon via zippopotam.us (free, no key). Cached per-ZIP.
const zipGeoCache = new TtlCache<string, Geo>(GEO_TTL_MS);

async function getGeoFromZip(zip: string): Promise<Geo> {
  const cached = zipGeoCache.get(zip);
  if (cached) return cached;
  let j: { places?: { 'place name': string; 'state abbreviation': string; latitude: string; longitude: string }[] };
  try {
    j = await fetchJson(`https://api.zippopotam.us/us/${zip}`, undefined, { label: 'zippopotam' });
  } catch {
    throw new Error(`Unknown ZIP code "${zip}"`);
  }
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
  zipGeoCache.set(zip, data);
  return data;
}

// ── Weather fetch ─────────────────────────────────────────────────────────────

const weatherCache = new TtlCache<string, WeatherData>(TTL_MS);

type TempUnit = 'f' | 'c';
type WindUnit = 'mph' | 'kmh';

function buildUrl(lat: number, lon: number, timezone: string, temp: TempUnit, wind: WindUnit): string {
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
  url.searchParams.set('temperature_unit', temp === 'c' ? 'celsius' : 'fahrenheit');
  url.searchParams.set('windspeed_unit', wind === 'kmh' ? 'kmh' : 'mph');
  url.searchParams.set('timezone', timezone);
  url.searchParams.set('forecast_days', '6');
  return url.toString();
}

async function fetchWeather(geo: Geo, temp: TempUnit, wind: WindUnit): Promise<WeatherData> {
  const raw = await fetchJson<{
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
  }>(buildUrl(geo.lat, geo.lon, geo.timezone, temp, wind), undefined, { label: 'Open-Meteo' });

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
    alerts: [],
    fetchedAt: new Date().toISOString(),
  };
}

// NWS active alerts for a point — keyless, US only. Returns [] on any failure / non-US.
async function fetchAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  try {
    const j = await fetchJson<{
      features?: { properties: { event: string; severity: string; headline: string } }[];
    }>(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: { 'User-Agent': '(Nishboard, personal desktop dashboard)', Accept: 'application/geo+json' } },
      { label: 'NWS alerts' },
    );
    return (j.features ?? []).slice(0, 5).map((f) => ({
      event: f.properties.event,
      severity: f.properties.severity,
      headline: f.properties.headline,
    }));
  } catch {
    return [];
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const weatherRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Querystring: { zip?: string; temp?: string; wind?: string }; Reply: WeatherData | { error: string } }>(
    '/',
    async (req, reply) => {
      const rawZip = (req.query.zip ?? '').trim();
      const zip = /^\d{5}$/.test(rawZip) ? rawZip : '';
      // Units default to imperial; anything unrecognized falls back rather than erroring.
      const temp: TempUnit = req.query.temp === 'c' ? 'c' : 'f';
      const wind: WindUnit = req.query.wind === 'kmh' ? 'kmh' : 'mph';
      // Units are part of the cache key — the cached payload's numbers are unit-specific.
      const key = `${zip || 'auto'}:${temp}:${wind}`;

      const cached = weatherCache.get(key);
      if (cached) return reply.send(cached);

      // 1) Resolve a location. Distinguish geolocation failures (422 — the user can act on
      //    them) from downstream forecast failures (502 — transient upstream).
      let geo: Geo;
      try {
        geo = zip ? await getGeoFromZip(zip) : await getGeoFromIp();
      } catch (err) {
        if (zip) {
          // A ZIP was provided but couldn't be geocoded → surface "Unknown ZIP …".
          throw new HttpError(422, err instanceof Error ? err.message : `Unknown ZIP code "${zip}".`);
        }
        // Auto (IP) geolocation failed and no ZIP is set → guide the user to set one.
        // The ZIP path uses a different provider (zippopotam.us, HTTPS), so it bypasses this.
        throw new HttpError(
          422,
          "Couldn't detect your location automatically. Add a ZIP code in Settings → App.",
        );
      }

      // 2) Fetch the forecast (+ alerts) for the resolved location.
      try {
        const [data, alerts] = await Promise.all([fetchWeather(geo, temp, wind), fetchAlerts(geo.lat, geo.lon)]);
        data.alerts = alerts;
        weatherCache.set(key, data);
        return reply.send(data);
      } catch {
        throw new HttpError(502, 'Weather service is unavailable, try again shortly.');
      }
    },
  );
};
