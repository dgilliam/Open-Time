"use client";

// GitHub-contributions-style heatmap: weeks as columns, Mon-first rows, 5
// intensity buckets on the accent scale (works in light and dark via
// color-mix against the themed surface color).

import { useEffect, useRef } from "react";
import { formatShortDate, hoursLabel } from "@/lib/format";

const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];
// Minimum gap (in weeks) between two month labels so adjacent labels at a
// month boundary don't render on top of each other in the narrow columns.
const MIN_LABEL_GAP_WEEKS = 3;

function bucketOf(hours: number): number {
  if (hours <= 0) return 0;
  if (hours < 2) return 1;
  if (hours < 4) return 2;
  if (hours < 6) return 3;
  return 4;
}

export function Heatmap({ days }: { days: { date: Date; hours: number }[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to the most recent weeks (today's end of the range) by default,
  // rather than showing the oldest ~12-month-ago data first.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days]);

  // `days` is expected sorted ascending, starting on a Monday, length a
  // multiple of 7 (the calling page builds it that way from one /api/calendar
  // fetch covering the last ~12 months).
  const weeks: { date: Date; hours: number }[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  let lastMonth = -1;
  let lastLabelIndex = -MIN_LABEL_GAP_WEEKS;
  const monthLabels = weeks.map((week, i) => {
    const monday = week[0].date;
    const m = monday.getMonth();
    if (m !== lastMonth && i - lastLabelIndex >= MIN_LABEL_GAP_WEEKS) {
      lastMonth = m;
      lastLabelIndex = i;
      return monday.toLocaleDateString(undefined, { month: "short" });
    }
    lastMonth = m;
    return "";
  });

  return (
    <div className="heatmap">
      <div className="heatmap-scroll" ref={scrollRef}>
        <div className="heatmap-months">
          <span className="heatmap-row-label-spacer" aria-hidden="true" />
          {monthLabels.map((label, i) => (
            <span key={i} className="heatmap-month-label">
              {label}
            </span>
          ))}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-row-labels">
            {ROW_LABELS.map((label, i) => (
              <span key={i} className="heatmap-row-label">
                {label}
              </span>
            ))}
          </div>
          <div className="heatmap-grid">
            {weeks.map((week, wi) => (
              <div key={wi} className="heatmap-col">
                {week.map((day, di) => (
                  <div
                    key={di}
                    className="heatmap-cell"
                    data-bucket={bucketOf(day.hours)}
                    title={`${formatShortDate(day.date)} — ${hoursLabel(day.hours * 3600)}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="heatmap-legend">
        <span className="muted small">Less</span>
        {[0, 1, 2, 3, 4].map((b) => (
          <span key={b} className="heatmap-cell heatmap-legend-cell" data-bucket={b} />
        ))}
        <span className="muted small">More</span>
      </div>
    </div>
  );
}
