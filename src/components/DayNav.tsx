"use client";

// Day navigator for the Timer page's entries list (v2.6 section A): ‹ ›
// around a date label ("Today" or e.g. "Thu, Jul 3"), plus a "Today" reset
// shown only when viewing a day other than today.

import { formatDayLabel, startOfDay } from "@/lib/format";

export function DayNav({
  day,
  onChange,
}: {
  day: Date;
  onChange: (day: Date) => void;
}) {
  const isToday = startOfDay(day).getTime() === startOfDay(new Date()).getTime();

  function shift(deltaDays: number) {
    const next = new Date(day);
    next.setDate(next.getDate() + deltaDays);
    onChange(startOfDay(next));
  }

  return (
    <div className="toolbar day-nav">
      <button type="button" className="btn" onClick={() => shift(-1)} aria-label="Previous day">
        ‹
      </button>
      <span className="week-label">{formatDayLabel(day)}</span>
      <button type="button" className="btn" onClick={() => shift(1)} aria-label="Next day">
        ›
      </button>
      {!isToday && (
        <button type="button" className="btn" onClick={() => onChange(startOfDay(new Date()))}>
          Today
        </button>
      )}
    </div>
  );
}
