import type { FastifyPluginAsync } from 'fastify';
import type { WeatherData, WeatherAlert, AirQualityData } from '@dash/shared';
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
    'sunrise', 'sunset',
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
      sunrise: string[];
      sunset: string[];
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
      sunrise: raw.daily.sunrise[i],
      sunset: raw.daily.sunset[i],
    })),
    location: { name: geo.name, region: geo.region || undefined, lat: geo.lat, lon: geo.lon },
    alerts: [],
    fetchedAt: new Date().toISOString(),
  };
}

// Air quality (+ pollen) — separate Open-Meteo host. Fail-soft like alerts:
// the forecast still renders if this call dies, the widget just omits the row.
async function fetchAirQuality(lat: number, lon: number): Promise<AirQualityData | undefined> {
  try {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set('current', [
      'us_aqi',
      // Pollen is CAMS (Europe-only) — request it everywhere, it's null elsewhere.
      'alder_pollen', 'birch_pollen', 'olive_pollen',
      'grass_pollen', 'mugwort_pollen', 'ragweed_pollen',
    ].join(','));
    const j = await fetchJson<{
      current: {
        us_aqi: number | null;
        alder_pollen: number | null; birch_pollen: number | null; olive_pollen: number | null;
        grass_pollen: number | null; mugwort_pollen: number | null; ragweed_pollen: number | null;
      };
    }>(url.toString(), undefined, { label: 'Open-Meteo AQ' });

    const c = j.current;
    const max = (...vals: (number | null)[]) => {
      const nums = vals.filter((v): v is number => v != null);
      return nums.length ? Math.max(...nums) : null;
    };
    const tree = max(c.alder_pollen, c.birch_pollen, c.olive_pollen);
    const weed = max(c.mugwort_pollen, c.ragweed_pollen);
    const grass = c.grass_pollen;
    const hasPollen = tree != null || weed != null || grass != null;
    return {
      usAqi: c.us_aqi,
      pollen: hasPollen ? { grass, tree, weed } : null,
    };
  } catch {
    return undefined;
  }
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

      // 2) Fetch the forecast (+ alerts + air quality) for the resolved location.
      try {
        const [data, alerts, airQuality] = await Promise.all([
          fetchWeather(geo, temp, wind),
          fetchAlerts(geo.lat, geo.lon),
          fetchAirQuality(geo.lat, geo.lon),
        ]);
        data.alerts = alerts;
        data.airQuality = airQuality;
        weatherCache.set(key, data);
        return reply.send(data);
      } catch {
        throw new HttpError(502, 'Weather service is unavailable, try again shortly.');
      }
    },
  );

  // Radar embed — a minimal page wrapping RainViewer's animated radar iframe.
  // Served from localhost (not iframed directly from file://) per the standing
  // embed pattern, and so the vendor can be swapped without touching the renderer.
  fastify.get<{ Querystring: { lat?: string; lon?: string } }>(
    '/radar-embed',
    async (req, reply) => {
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        throw new HttpError(400, 'lat/lon required');
      }
      // oCS=1 dark color scheme base map; sm/sn = smooth + snow; loc = lat,lon,zoom
      const src = `https://www.rainviewer.com/map.html?loc=${lat.toFixed(4)},${lon.toFixed(4)},7&oCS=1&sm=1&sn=1&layer=radar&hu=false`;
      return reply.type('text/html').send(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden}
  iframe{border:0;width:100%;height:100%;display:block}
</style></head>
<body><iframe src="${src}" allowfullscreen></iframe></body></html>`);
    },
  );
};
