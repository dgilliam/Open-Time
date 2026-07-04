"use client";

// Month grid (Mon-Sun columns): each day shows its number and rounded hours
// when nonzero, with a background tint scaled by hours; today is outlined.

import { addDays, dateInputValue, hoursLabel, startOfMonth, startOfWeek } from "@/lib/format";
import type { CalendarDay } from "@/lib/types";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Tint alpha (0-1) for the color-mix background, scaled by hours (capped at 8h/day). */
function tintAlpha(hours: number): number {
  if (hours <= 0) return 0;
  return Math.min(1, hours / 8) * 0.75 + 0.1;
}

export function MonthCalendar({
  month,
  data,
  onPrev,
  onNext,
  onToday,
}: {
  month: Date;
  data: CalendarDay[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const byDate = new Map(data.map((d) => [d.date, d.hours]));
  const monthStart = startOfMonth(month);
  const gridStart = startOfWeek(monthStart);
  const today = dateInputValue(new Date());

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(gridStart, i));

  const label = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="month-calendar">
      <div className="toolbar">
        <button type="button" className="btn" onClick={onPrev} aria-label="Previous month">
          ‹
        </button>
        <span className="week-label">{label}</span>
        <button type="button" className="btn" onClick={onNext} aria-label="Next month">
          ›
        </button>
        <button type="button" className="btn" onClick={onToday}>
          Today
        </button>
      </div>
      <div className="month-grid">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="month-weekday">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const key = dateInputValue(d);
          const hours = byDate.get(key) ?? 0;
          const inMonth = d.getMonth() === monthStart.getMonth();
          const isToday = key === today;
          const alpha = tintAlpha(hours);
          const className = [
            "month-cell",
            inMonth ? "" : "out-of-month",
            isToday ? "today" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div
              key={key}
              className={className}
              style={alpha > 0 ? ({ "--tint-alpha": alpha } as React.CSSProperties) : undefined}
            >
              <span className="month-cell-date">{d.getDate()}</span>
              {hours > 0 && <span className="month-cell-hours">{hoursLabel(hours * 3600)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
