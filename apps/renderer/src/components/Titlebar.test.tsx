import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WeatherData } from '@dash/shared';
import { Titlebar } from './Titlebar';
import { useAppSettingsStore } from '../store/settingsStore';

// The weather query cache is shared app-wide (WeatherAlertNotifier populates it
// globally) — the Titlebar must survive whatever payload shape lands in it.
// Regression: `weather.data?.current.temp` crashed the shell on a malformed
// cached payload before it was hardened to `data?.current?.temp`.

function renderTitlebar(cached?: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } },
  });
  if (cached !== undefined) {
    // Default settings → zip '' + imperial units = this exact key.
    queryClient.setQueryData(['weather', '', 'f', 'mph'], cached);
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Titlebar />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useAppSettingsStore.setState({ weatherZips: [], weatherZipIdx: 0, showTempInClock: true, tempUnit: 'f', windUnit: 'mph' });
  // No query should ever hit the network from these tests.
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('network disabled in test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Titlebar weather-in-clock', () => {
  it('renders the temperature from a healthy cached payload', () => {
    const data = {
      current: { temp: 72, feelsLike: 74, humidity: 50, windSpeed: 5, uvIndex: 3, precipChance: 0, weatherCode: 1 },
      hourly: [], daily: [],
      location: { name: 'Cambridge', lat: 0, lon: 0 },
      alerts: [],
      fetchedAt: new Date().toISOString(),
    } satisfies Partial<WeatherData> as WeatherData;
    renderTitlebar(data);
    expect(screen.getByText(/· 72°/)).toBeTruthy();
  });

  it('survives a malformed cached payload (no current) without crashing the shell', () => {
    expect(() => renderTitlebar({})).not.toThrow();
    expect(screen.getByText('nishboard')).toBeTruthy();
    expect(screen.queryByText(/°/)).toBeNull(); // temp simply omitted
  });

  it('survives an empty cache while the query is loading', () => {
    expect(() => renderTitlebar()).not.toThrow();
    expect(screen.getByText('nishboard')).toBeTruthy();
  });
});
