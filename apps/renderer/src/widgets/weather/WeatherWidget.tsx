import { useEffect } from 'react';
import {
  Droplets, Wind, Zap, Umbrella, AlertTriangle,
  Sunrise, Sunset, Radar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useWeather } from './useWeather';
import { getWeatherMeta } from './weatherCodes';
import { WeatherIcon } from './WeatherIcon';
import { useDragScroll } from '../../hooks/useDragScroll';
import { WidgetSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { RefreshAction } from '../../components/RefreshAction';
import { HeaderAction } from '../../components/HeaderAction';
import { useAppSettingsStore } from '../../store/settingsStore';
import { useWeatherUiStore } from '../../store/weatherUiStore';
import { apiUrl } from '../../lib/apiClient';
import { hourFormat } from '../../lib/time';
import { cn } from '../../lib/utils';

function formatHour(isoTime: string, clock24h: boolean): string {
  const date = new Date(isoTime);
  const h = date.getHours();
  if (clock24h) return `${h}:00`;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

function formatDay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

/** Open-Meteo returns local wall-time ISO strings ("2026-07-04T05:42") —
 *  parse + format both happen in machine-local time, so the digits pass through. */
function formatSun(iso: string, clock24h: boolean): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', ...hourFormat(clock24h),
  });
}

const AQI_LEVELS = [
  { max: 50,       label: 'Good',           dot: 'bg-emerald-400' },
  { max: 100,      label: 'Moderate',       dot: 'bg-yellow-400' },
  { max: 150,      label: 'Unhealthy (SG)', dot: 'bg-orange-400' },
  { max: 200,      label: 'Unhealthy',      dot: 'bg-red-400' },
  { max: 300,      label: 'Very unhealthy', dot: 'bg-purple-400' },
  { max: Infinity, label: 'Hazardous',      dot: 'bg-rose-800' },
] as const;

function aqiMeta(aqi: number) {
  return AQI_LEVELS.find((l) => aqi <= l.max) ?? AQI_LEVELS[AQI_LEVELS.length - 1];
}

/** WidgetShell header actions for the weather tile. */
export function WeatherActions() {
  const radarOpen = useWeatherUiStore((s) => s.radarOpen);
  const toggleRadar = useWeatherUiStore((s) => s.toggleRadar);
  return (
    <>
      <HeaderAction title={radarOpen ? 'Hide radar' : 'Show radar'} active={radarOpen} onClick={toggleRadar}>
        <Radar size={12} />
      </HeaderAction>
      <RefreshAction queryKey={['weather']} title="Refresh weather" />
    </>
  );
}

export function WeatherWidget() {
  const { data, isLoading, isError, error } = useWeather();
  const tempUnit = useAppSettingsStore((s) => s.tempUnit);
  const windUnit = useAppSettingsStore((s) => s.windUnit);
  const clock24h = useAppSettingsStore((s) => s.clock24h);
  const zips = useAppSettingsStore((s) => s.weatherZips);
  const zipIdx = useAppSettingsStore((s) => s.weatherZipIdx);
  const setZipIdx = useAppSettingsStore((s) => s.setWeatherZipIdx);
  const radarOpen = useWeatherUiStore((s) => s.radarOpen);
  const tempLabel = tempUnit === 'c' ? 'C' : 'F';
  const windLabel = windUnit === 'kmh' ? 'km/h' : 'mph';
  const multiLoc = zips.length > 1;
  const cycle = (dir: 1 | -1) => setZipIdx((zipIdx + dir + zips.length) % zips.length);

  // Drag-to-pan the hourly strip (the hook's callback ref fires once the
  // element mounts after the loading/error early-returns below).
  const { ref: setHourlyEl, el: hourlyEl } = useDragScroll<HTMLDivElement>('x');

  // Vertical wheel → horizontal scroll on the strip (weather-specific).
  useEffect(() => {
    if (!hourlyEl) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0) return; // let native horizontal scroll pass through
      e.preventDefault();
      // deltaMode 1 = line mode (Windows standard mouse); multiply to get pixels
      const px = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      hourlyEl.scrollLeft += px;
    };
    hourlyEl.addEventListener('wheel', onWheel, { passive: false });
    return () => hourlyEl.removeEventListener('wheel', onWheel);
  }, [hourlyEl]);

  if (isLoading) {
    return <WidgetSkeleton lines={4} />;
  }

  if (isError || !data) {
    // Surface the server's message (e.g. the geolocation hint that suggests setting a ZIP)
    // instead of a generic failure string.
    const message = error instanceof Error && error.message ? error.message : 'Failed to load weather';
    return <ErrorState message={message} queryKey={['weather']} />;
  }

  const { current, hourly, daily, location } = data;
  const alerts = data.alerts ?? []; // defensive: older cached responses may lack it
  const meta = getWeatherMeta(current.weatherCode);
  const severeAlert = alerts.some((a) => a.severity === 'Extreme' || a.severity === 'Severe');
  const today = daily[0];
  const aqi = data.airQuality?.usAqi ?? null;
  const pollen = data.airQuality?.pollen ?? null;

  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto">

      {/* Radar — iframe mounts only while open (lazy by design) */}
      {radarOpen && location.lat != null && (
        <div className="shrink-0 h-52 rounded-lg overflow-hidden border border-th-line">
          <iframe
            src={apiUrl(`/api/weather/radar-embed?lat=${location.lat}&lon=${location.lon}`)}
            className="w-full h-full"
            title="Weather radar"
          />
        </div>
      )}

      {/* Severe-weather alerts (NWS) */}
      {alerts.length > 0 && (
        <div
          className={cn(
            'shrink-0 flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 border',
            severeAlert ? 'bg-red-500/15 border-red-500/30' : 'bg-amber-500/15 border-amber-500/30',
          )}
          title={alerts.map((a) => a.headline || a.event).join('\n')}
        >
          <AlertTriangle className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', severeAlert ? 'text-red-400' : 'text-amber-400')} />
          <div className="min-w-0">
            <p className={cn('text-xs font-medium leading-tight', severeAlert ? 'text-red-300' : 'text-amber-300')}>
              {alerts[0].event}
            </p>
            {alerts.length > 1 && (
              <p className={cn('text-[10px]', severeAlert ? 'text-red-400/70' : 'text-amber-400/70')}>
                +{alerts.length - 1} more alert{alerts.length - 1 > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Current conditions */}
      <div className="flex items-start justify-between shrink-0">
        <div>
          <div className="flex items-end gap-2">
            <span className="text-6xl font-light text-th-hi leading-none">{current.temp}°</span>
            <span className="text-th-2 text-base mb-1">{tempLabel}</span>
          </div>
          <p className="text-th-2 text-sm mt-1">{meta.label}</p>
          <div className="flex items-center gap-0.5 mt-0.5">
            {multiLoc && (
              <button onClick={() => cycle(-1)} className="text-th-ghost hover:text-th-2 transition-colors" title="Previous location">
                <ChevronLeft size={12} />
              </button>
            )}
            <p className="text-th-ghost text-xs">
              {location.name}{location.region ? `, ${location.region}` : ''}
              {multiLoc && <span className="ml-1 tabular-nums">{zipIdx % zips.length + 1}/{zips.length}</span>}
            </p>
            {multiLoc && (
              <button onClick={() => cycle(1)} className="text-th-ghost hover:text-th-2 transition-colors" title="Next location">
                <ChevronRight size={12} />
              </button>
            )}
          </div>
        </div>
        <WeatherIcon icon={meta.icon} className="w-14 h-14 text-th-hi shrink-0" />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {[
          { icon: <Droplets className="w-3.5 h-3.5" />, label: 'Humidity', value: `${current.humidity}%` },
          { icon: <Wind className="w-3.5 h-3.5" />,     label: 'Wind',     value: `${current.windSpeed}${windLabel}` },
          { icon: <Umbrella className="w-3.5 h-3.5" />, label: 'Rain',     value: `${current.precipChance}%` },
          { icon: <Zap className="w-3.5 h-3.5" />,      label: 'UV',       value: `${Math.round(current.uvIndex)}` },
        ].map(({ icon, label, value }) => (
          <div key={label} className="bg-th-elevated/60 rounded-lg p-2 flex flex-col items-center gap-1">
            <span className="text-th-3">{icon}</span>
            <span className="text-th-hi text-sm font-medium">{value}</span>
            <span className="text-th-ghost text-xs">{label}</span>
          </div>
        ))}
      </div>

      {/* Feels like · sun times · air quality */}
      <div className="flex items-center gap-3 flex-wrap shrink-0 text-xs text-th-3">
        <span>Feels like {current.feelsLike}°{tempLabel}</span>
        {today?.sunrise && (
          <span className="flex items-center gap-1" title="Sunrise">
            <Sunrise size={13} className="text-amber-300" />{formatSun(today.sunrise, clock24h)}
          </span>
        )}
        {today?.sunset && (
          <span className="flex items-center gap-1" title="Sunset">
            <Sunset size={13} className="text-orange-400" />{formatSun(today.sunset, clock24h)}
          </span>
        )}
        {aqi != null && (
          <span className="flex items-center gap-1.5" title="US Air Quality Index">
            <span className={cn('w-2 h-2 rounded-full shrink-0', aqiMeta(aqi).dot)} />
            AQI {Math.round(aqi)} · {aqiMeta(aqi).label}
          </span>
        )}
      </div>

      {/* Pollen — CAMS data is Europe-only; hidden when every type is null */}
      {pollen && (
        <p className="text-th-ghost text-xs shrink-0">
          Pollen (gr/m³)
          {pollen.tree != null && <> · Tree {Math.round(pollen.tree)}</>}
          {pollen.grass != null && <> · Grass {Math.round(pollen.grass)}</>}
          {pollen.weed != null && <> · Weed {Math.round(pollen.weed)}</>}
        </p>
      )}

      {/* Hourly strip */}
      <div className="shrink-0">
        <p className="text-th-ghost text-xs uppercase tracking-widest mb-2">Hourly</p>
        <div ref={setHourlyEl} className="flex gap-2 overflow-x-auto scrollbar-none cursor-grab select-none">
          {hourly.map((h) => {
            const hMeta = getWeatherMeta(h.weatherCode);
            return (
              <div
                key={h.time}
                className="flex flex-col items-center gap-1 shrink-0 min-w-[44px]"
                title={`${h.precipChance}% chance of precipitation`}
              >
                <span className="text-th-3 text-xs">{formatHour(h.time, clock24h)}</span>
                <WeatherIcon icon={hMeta.icon} className="w-4 h-4 text-th-2" />
                <span className="text-th-hi text-xs font-medium">{h.temp}°</span>
                {/* Constant-height precip track (mirrors the 5-day bar) — an
                    always-present bar kills the column-height jitter the old
                    conditional >20% text caused. */}
                <span
                  className="h-6 w-1 rounded-full bg-th-elevated overflow-hidden flex flex-col justify-end"
                  data-precip={h.precipChance}
                >
                  <span className="w-full bg-blue-500/40" style={{ height: `${h.precipChance}%` }} />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily strip */}
      <div className="shrink-0">
        <p className="text-th-ghost text-xs uppercase tracking-widest mb-2">5-Day</p>
        <div className="flex flex-col gap-1.5">
          {daily.map((d) => {
            const dMeta = getWeatherMeta(d.weatherCode);
            return (
              <div key={d.date} className="flex items-center gap-3">
                <span className="text-th-3 text-xs w-8 shrink-0">{formatDay(d.date)}</span>
                <WeatherIcon icon={dMeta.icon} className="w-4 h-4 text-th-2 shrink-0" />
                <div className="flex-1 h-1 bg-th-elevated rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500/40 rounded-full"
                    style={{ width: `${d.precipChance}%` }}
                  />
                </div>
                <span className="text-th-hi text-xs w-14 shrink-0 text-right">
                  {d.tempMax}° / {d.tempMin}°
                </span>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
