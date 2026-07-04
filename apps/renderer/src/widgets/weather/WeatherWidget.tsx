import { useEffect } from 'react';
import { Droplets, Wind, Zap, Umbrella, AlertTriangle } from 'lucide-react';
import { useWeather } from './useWeather';
import { getWeatherMeta } from './weatherCodes';
import { WeatherIcon } from './WeatherIcon';
import { useDragScroll } from '../../hooks/useDragScroll';
import { WidgetSkeleton } from '../../components/Skeleton';
import { ErrorState } from '../../components/ErrorState';
import { RefreshAction } from '../../components/RefreshAction';
import { cn } from '../../lib/utils';

function formatHour(isoTime: string): string {
  const date = new Date(isoTime);
  const h = date.getHours();
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

function formatDay(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00');
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

/** WidgetShell header actions for the weather tile. */
export function WeatherActions() {
  return <RefreshAction queryKey={['weather']} title="Refresh weather" />;
}

export function WeatherWidget() {
  const { data, isLoading, isError, error } = useWeather();

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

  return (
    <div className="h-full flex flex-col gap-3 p-3 overflow-y-auto">

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
            <span className="text-th-2 text-base mb-1">F</span>
          </div>
          <p className="text-th-2 text-sm mt-1">{meta.label}</p>
          <p className="text-th-ghost text-xs mt-0.5">
            {location.name}{location.region ? `, ${location.region}` : ''}
          </p>
        </div>
        <WeatherIcon icon={meta.icon} className="w-14 h-14 text-th-hi shrink-0" />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-4 gap-2 shrink-0">
        {[
          { icon: <Droplets className="w-3.5 h-3.5" />, label: 'Humidity', value: `${current.humidity}%` },
          { icon: <Wind className="w-3.5 h-3.5" />,     label: 'Wind',     value: `${current.windSpeed}mph` },
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

      {/* Feels like */}
      <p className="text-th-3 text-xs shrink-0">Feels like {current.feelsLike}°F</p>

      {/* Hourly strip */}
      <div className="shrink-0">
        <p className="text-th-ghost text-xs uppercase tracking-widest mb-2">Hourly</p>
        <div ref={setHourlyEl} className="flex gap-2 overflow-x-auto scrollbar-none cursor-grab select-none">
          {hourly.map((h) => {
            const hMeta = getWeatherMeta(h.weatherCode);
            return (
              <div key={h.time} className="flex flex-col items-center gap-1 shrink-0 min-w-[44px]">
                <span className="text-th-3 text-xs">{formatHour(h.time)}</span>
                <WeatherIcon icon={hMeta.icon} className="w-4 h-4 text-th-2" />
                <span className="text-th-hi text-xs font-medium">{h.temp}°</span>
                {h.precipChance > 20 && (
                  <span className="text-blue-400 text-xs">{h.precipChance}%</span>
                )}
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
