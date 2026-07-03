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
}

export interface WeatherLocation {
  name: string;
  region?: string;
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
  fetchedAt: string;
}
