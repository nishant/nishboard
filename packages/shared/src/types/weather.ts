export interface WeatherCurrent {
  temp: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  uvIndex: number;
  precipChance: number;
  weatherCode: number;
}

export interface WeatherHourly {
  time: string;
  temp: number;
  precipChance: number;
  weatherCode: number;
}

export interface WeatherDaily {
  date: string;
  tempMax: number;
  tempMin: number;
  precipChance: number;
  weatherCode: number;
  /** ISO local datetimes from Open-Meteo (e.g. "2026-07-04T05:42"). */
  sunrise: string;
  sunset: string;
}

export interface WeatherLocation {
  name: string;
  region?: string;
  /** Resolved coordinates — the renderer needs them for the radar embed. */
  lat: number;
  lon: number;
}

/** Pollen grains/m³ by type — CAMS covers Europe only; all-null in the US. */
export interface PollenData {
  grass: number | null;
  tree: number | null; // max of alder/birch/olive
  weed: number | null; // max of mugwort/ragweed
}

export interface AirQualityData {
  /** US AQI (0–500). */
  usAqi: number | null;
  /** null when no pollen type has data for this location (e.g. anywhere outside Europe). */
  pollen: PollenData | null;
}

export interface WeatherAlert {
  event: string; // e.g. "Severe Thunderstorm Warning"
  severity: string; // "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown"
  headline: string;
}

export interface WeatherData {
  current: WeatherCurrent;
  hourly: WeatherHourly[];
  daily: WeatherDaily[];
  location: WeatherLocation;
  /** Active NWS severe-weather alerts (US only; empty otherwise). */
  alerts: WeatherAlert[];
  /** Fail-soft: absent when the air-quality API call failed. */
  airQuality?: AirQualityData;
  fetchedAt: string;
}
