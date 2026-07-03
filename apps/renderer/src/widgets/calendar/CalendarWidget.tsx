import { useState, useEffect } from 'react';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Returns array of 42 cells (6 full weeks): null for padding, number for day-of-month
function buildGrid(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length < 42) cells.push(null); // always 6 rows
  return cells;
}

function MonthView({
  year, month, todayYear, todayMonth, todayDate,
}: {
  year: number; month: number;
  todayYear: number; todayMonth: number; todayDate: number;
}) {
  const cells = buildGrid(year, month);
  const label = new Date(year, month, 1).toLocaleString('default', { month: 'long' });
  const isCurrent = year === todayYear && month === todayMonth;

  return (
    <div className="flex flex-col min-w-0 min-h-0">
      <p className={`text-[11px] font-semibold text-center mb-1.5 shrink-0 ${isCurrent ? 'text-th-hi' : 'text-th-3'}`}>
        {label} {year}
      </p>
      <div className="grid grid-cols-7 shrink-0 mb-0.5">
        {DOW.map((d) => (
          <span key={d} className="text-center text-[9px] font-medium text-th-ghost uppercase tracking-wide">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {cells.map((d, i) => {
          const isToday = isCurrent && d === todayDate;
          return (
            <div
              key={i}
              className={`flex items-center justify-center text-[11px] h-6 rounded-full ${
                d === null ? 'invisible' :
                isToday ? 'bg-th-invert-bg text-th-invert-text font-bold' :
                'text-th-2'
              }`}
            >
              {d ?? ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CalendarWidget() {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(1);
  const [rows, setRows] = useState(1);

  // Same callback-ref + retry-RAF pattern as SpotifyWidget to handle
  // both conditional renders and macOS compositing delays
  useEffect(() => {
    if (!containerEl) return;

    const MIN_W = 155; // px — min width per month column
    const MIN_H = 195; // px — min height per month row

    const compute = (w: number, h: number) => {
      setCols(Math.max(1, Math.floor(w / MIN_W)));
      setRows(Math.max(1, Math.floor(h / MIN_H)));
    };

    let rafId: number;
    const tryMeasure = () => {
      const { width, height } = containerEl.getBoundingClientRect();
      if (width > 0 && height > 0) {
        compute(width, height);
      } else {
        rafId = requestAnimationFrame(tryMeasure);
      }
    };
    rafId = requestAnimationFrame(tryMeasure);

    const ro = new ResizeObserver(([entry]) => {
      compute(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(containerEl);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [containerEl]);

  // Re-render at midnight: without a tick the today-highlight (and the visible
  // month range) stays on yesterday until a resize/remount forces a render.
  const [dateKey, setDateKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const id = setInterval(() => {
      const key = new Date().toDateString();
      setDateKey((prev) => (prev === key ? prev : key));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const today = new Date(dateKey);
  const todayYear = today.getFullYear();
  const todayMonth = today.getMonth();
  const todayDate = today.getDate();

  const numMonths = cols * rows;

  // With 1-2 months start at current; with 3+ anchor so current is second
  const startOffset = numMonths >= 3 ? -1 : 0;

  const months = Array.from({ length: numMonths }, (_, i) => {
    let m = todayMonth + startOffset + i;
    let y = todayYear;
    while (m < 0) { m += 12; y--; }
    while (m > 11) { m -= 12; y++; }
    return { year: y, month: m };
  });

  return (
    <div ref={setContainerEl} className="h-full p-3 overflow-hidden">
      <div
        className="h-full"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          gap: '16px',
        }}
      >
        {months.map(({ year, month }) => (
          <MonthView
            key={`${year}-${month}`}
            year={year}
            month={month}
            todayYear={todayYear}
            todayMonth={todayMonth}
            todayDate={todayDate}
          />
        ))}
      </div>
    </div>
  );
}
