import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WeatherData } from '@dash/shared';
import { buildServer } from '../app';
import { fnv1a } from './weather';
import { jsonRes, stubFetch, textRes } from '../test/fetchStub';
import { vi } from 'vitest';

// NOTE: the weather route keeps module-level TTL caches keyed by zip+units —
// each test uses a DISTINCT zip so tests can't serve each other's fixtures.

function zipFixture(city = 'Cambridge'): Response {
  return jsonRes({
    places: [{ 'place name': city, 'state abbreviation': 'MA', latitude: '42.3736', longitude: '-71.1097' }],
  });
}

function meteoFixture(): Response {
  const hours = Array.from({ length: 24 }, (_, i) => `2026-07-05T${String(i).padStart(2, '0')}:00`);
  return jsonRes({
    current: {
      time: '2026-07-05T10:00',
      temperature_2m: 71.6,
      apparent_temperature: 74.2,
      relative_humidity_2m: 60,
      precipitation_probability: 15,
      weathercode: 2,
      windspeed_10m: 7.3,
      uv_index: 5.2,
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map((_, i) => 60 + i),
      precipitation_probability: hours.map((_, i) => i * 2),
      weathercode: hours.map(() => 1),
    },
    daily: {
      time: ['2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'],
      weathercode: [1, 2, 3, 61, 0, 2],
      temperature_2m_max: [80.4, 82, 79, 75, 77, 81],
      temperature_2m_min: [61, 63, 60, 58, 59, 62],
      precipitation_probability_max: [10, 20, 30, 80, 5, 15],
      sunrise: ['2026-07-05T05:12', '2026-07-06T05:13', '2026-07-07T05:14', '2026-07-08T05:15', '2026-07-09T05:16', '2026-07-10T05:17'],
      sunset: ['2026-07-05T20:24', '2026-07-06T20:23', '2026-07-07T20:22', '2026-07-08T20:21', '2026-07-09T20:20', '2026-07-10T20:19'],
    },
  });
}

const aqFixture = (): Response =>
  jsonRes({
    current: {
      us_aqi: 42,
      alder_pollen: null, birch_pollen: null, olive_pollen: null,
      grass_pollen: null, mugwort_pollen: null, ragweed_pollen: null,
    },
  });

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

describe('GET /api/weather', () => {
  it('returns a full WeatherData payload for a ZIP (geocode + forecast + alerts + AQI)', async () => {
    stubFetch([
      ['zippopotam.us/us/02139', () => zipFixture()],
      ['api.open-meteo.com/v1/forecast', () => meteoFixture()],
      ['air-quality-api.open-meteo.com', () => aqFixture()],
      ['api.weather.gov/alerts', () =>
        jsonRes({
          features: [
            { properties: { id: 'urn:nws:alert:1', event: 'Heat Advisory', severity: 'Moderate', headline: 'Heat through Tuesday' } },
            // No properties.id — the route must synthesize the FNV-1a fallback.
            { properties: { event: 'Severe Thunderstorm Warning', severity: 'Severe', headline: 'Gusts to 70mph' } },
          ],
        })],
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/weather?zip=02139' });
    expect(res.statusCode).toBe(200);
    const data = res.json<WeatherData>();

    expect(data.current).toEqual({
      temp: 72, // rounded from 71.6
      feelsLike: 74,
      humidity: 60,
      windSpeed: 7,
      uvIndex: 5.2,
      precipChance: 15,
      weatherCode: 2,
    });
    // Hourly window starts at the current hour (10:00) and spans 12 entries.
    expect(data.hourly).toHaveLength(12);
    expect(data.hourly[0].time).toBe('2026-07-05T10:00');
    expect(data.daily).toHaveLength(5);
    expect(data.location.name).toBe('Cambridge');
    expect(data.location.region).toBe('MA');
    expect(data.airQuality).toEqual({ usAqi: 42, pollen: null });

    expect(data.alerts).toHaveLength(2);
    expect(data.alerts[0].id).toBe('urn:nws:alert:1');
    expect(data.alerts[1].id).toBe(`nws-${fnv1a('Severe Thunderstorm Warning|Gusts to 70mph')}`);
  });

  it('serves the TTL cache on a repeat request (no second upstream call)', async () => {
    const fetchSpy = stubFetch([
      ['zippopotam.us/us/10001', () => zipFixture('New York')],
      ['api.open-meteo.com/v1/forecast', () => meteoFixture()],
      ['air-quality-api.open-meteo.com', () => aqFixture()],
      ['api.weather.gov/alerts', () => jsonRes({ features: [] })],
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/weather?zip=10001' })).statusCode).toBe(200);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect((await app.inject({ method: 'GET', url: '/api/weather?zip=10001' })).statusCode).toBe(200);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('fails soft when NWS is down — forecast still renders, alerts are just empty', async () => {
    stubFetch([
      ['zippopotam.us/us/60601', () => zipFixture('Chicago')],
      ['api.open-meteo.com/v1/forecast', () => meteoFixture()],
      ['air-quality-api.open-meteo.com', () => aqFixture()],
      ['api.weather.gov/alerts', () => textRes('upstream exploded', 500)],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/weather?zip=60601' });
    expect(res.statusCode).toBe(200);
    expect(res.json<WeatherData>().alerts).toEqual([]);
  });

  it('maps an unknown ZIP to 422 with an actionable message', async () => {
    stubFetch([['zippopotam.us/us/99999', () => textRes('not found', 404)]]);
    const res = await app.inject({ method: 'GET', url: '/api/weather?zip=99999' });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: string }>().error).toContain('Unknown ZIP code "99999"');
  });

  it('maps a dead forecast upstream to 502', async () => {
    stubFetch([
      ['zippopotam.us/us/94105', () => zipFixture('San Francisco')],
      ['api.open-meteo.com/v1/forecast', () => textRes('boom', 500)],
      ['air-quality-api.open-meteo.com', () => aqFixture()],
      ['api.weather.gov/alerts', () => jsonRes({ features: [] })],
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/weather?zip=94105' });
    expect(res.statusCode).toBe(502);
    expect(res.json<{ error: string }>().error).toContain('Weather service is unavailable');
  });
});

describe('GET /api/weather/radar-embed', () => {
  it('rejects missing or out-of-range coordinates', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/weather/radar-embed' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/weather/radar-embed?lat=99&lon=0' })).statusCode).toBe(400);
  });

  it('serves an HTML wrapper around the radar iframe', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/weather/radar-embed?lat=42.37&lon=-71.11' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('rainviewer.com');
    expect(res.body).toContain('42.3700,-71.1100');
  });
});
