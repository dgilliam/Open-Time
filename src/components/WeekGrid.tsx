"use client";

// v3.0 week mode: seven Sun-first day columns (matching the old timesheet's
// week convention). Each column is a header (weekday + date + that day's
// total + a "+" add-time button) followed by that day's completed entries as
// cards, ordered by start time. A running timer (if any) renders as a
// distinct accent card at the top of TODAY's column, excluded from totals.
//
// Cards are deliberately compact (v3.1): one ellipsized line for the task
// name, then just the rounded hours — raw start/stop timestamps live in the
// edit drawer, not on the card. When the task carries wrap-up metadata,
// small indicators sit beside the hours: "↗" opens the task link (same
// affordance as the Reports and Dashboard tables) and "≡" flags details.
// Everything the compact face hides (full name, start–stop, status, link,
// details) is in the card's native hover tooltip via `cardTitle`.
//
// Card click (outside the task name / status badge / delete affordance)
// opens the edit drawer via `onEdit`; the task name always opens the wrap-up
// dialog via `onTaskClick`, even for invoice-locked entries (wrap-up
// metadata isn't invoice data — same rule as the old EntryList). Locked
// entries (member viewer only; admins are unaffected) render greyed with no
// edit/delete affordance, mirroring EntryList's v2.8 behavior.
//
// EntryDialog (drawer variant, reused verbatim) currently exposes no delete
// action in either create or edit mode, so this component keeps a small
// delete affordance directly on each (unlocked) card to preserve the
// capability EntryList used to offer.

import { useMemo } from "react";
import {
  addDays,
  dateInputValue,
  formatShortDate,
  formatTime,
  hoursLabel,
  isoWeekNumber,
  startOfWeekSun,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { useSession } from "@/components/SessionContext";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Cards show at most ~15 chars of the task name (full name in the tooltip
// and the edit drawer). The CSS ellipsis on .entry-card-task still guards
// columns too narrow even for this.
const TASK_NAME_MAX = 15;

function shortTaskName(name: string) {
  return name.length > TASK_NAME_MAX + 1 ? `${name.slice(0, TASK_NAME_MAX)}…` : name;
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  draft: "Draft",
  submitted: "Submitted",
  accepted: "Accepted",
  dead_end: "Dead end",
};

/** Native-tooltip summary of everything the compact card hides. */
function cardTitle(entry: TimeEntry): string {
  const lines = [
    entry.taskName,
    `${formatTime(entry.startedAt)} – ${entry.stoppedAt ? formatTime(entry.stoppedAt) : "—"} · ${
      entry.durationSecs != null ? hoursLabel(entry.durationSecs) : "—"
    }`,
    `Status: ${STATUS_LABELS[entry.taskStatus] ?? entry.taskStatus}`,
  ];
  if (entry.taskLink) lines.push(`Link: ${entry.taskLink}`);
  if (entry.taskDetails) lines.push(entry.taskDetails);
  return lines.join("\n");
}

export function WeekGrid({
  weekStart,
  onWeekStartChange,
  entries,
  running,
  onAdd,
  onEdit,
  onTaskClick,
  onStatusSaved,
  onDelete,
  onStartAgain,
}: {
  /** Sunday (local midnight) of the viewed week. */
  weekStart: Date;
  onWeekStartChange: (weekStart: Date) => void;
  /** Completed entries (stoppedAt !== null) within the viewed week's range. */
  entries: TimeEntry[];
  /** The signed-in user's running entry, if any — rendered separately from `entries`. */
  running: TimeEntry | null;
  onAdd: (day: Date) => void;
  onEdit: (entry: TimeEntry) => void;
  onTaskClick: (entry: TimeEntry) => void;
  /** Refetch callback for the status badge's in-place cycle. */
  onStatusSaved: () => void;
  onDelete: (id: string) => void;
  /** "Start again" (v3.2): start/swap the timer onto this card's task. */
  onStartAgain: (taskName: string) => void;
}) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart]);
  const dateKeys = useMemo(() => days.map(dateInputValue), [days]);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      const key = dateInputValue(new Date(entry.startedAt));
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    }
    return map;
  }, [entries]);

  const totalsByDate = useMemo(() => {
    const totals = new Map<string, number>();
    for (const entry of entries) {
      const key = dateInputValue(new Date(entry.startedAt));
      totals.set(key, (totals.get(key) ?? 0) + (entry.durationSecs ?? 0));
    }
    return totals;
  }, [entries]);

  const weekTotalSecs = entries.reduce((sum, entry) => sum + (entry.durationSecs ?? 0), 0);

  const monday = addDays(weekStart, 1);
  const weekNum = isoWeekNumber(monday);
  const isThisWeek = dateInputValue(weekStart) === dateInputValue(startOfWeekSun(new Date()));
  const label = isThisWeek
    ? `This week · W${weekNum}`
    : `${formatShortDate(weekStart)} – ${formatShortDate(addDays(weekStart, 6))} · W${weekNum}`;

  const todayKey = dateInputValue(new Date());
  const isEmptyWeek = entries.length === 0 && !running;

  return (
    <section className="section week-grid-section">
      <div className="toolbar">
        <button
          type="button"
          className="btn"
          onClick={() => onWeekStartChange(addDays(weekStart, -7))}
          aria-label="Previous week"
        >
          ‹
        </button>
        <span className="week-label">{label}</span>
        <button
          type="button"
          className="btn"
          onClick={() => onWeekStartChange(addDays(weekStart, 7))}
          aria-label="Next week"
        >
          ›
        </button>
        {!isThisWeek && (
          <button type="button" className="btn" onClick={() => onWeekStartChange(startOfWeekSun(new Date()))}>
            This week
          </button>
        )}
        <span className="week-total">
          Week total <span className="strong">{hoursLabel(weekTotalSecs)}</span>
        </span>
      </div>
      {isEmptyWeek && <p className="muted">No entries this week yet.</p>}
      <div className="week-grid-scroll">
        <div className="week-grid">
          {days.map((day, i) => {
            const dateKey = dateKeys[i];
            const dayEntries = entriesByDate.get(dateKey) ?? [];
            const daySecs = totalsByDate.get(dateKey) ?? 0;
            const isToday = dateKey === todayKey;
            const weekdayLabel = `${WEEKDAY_LABELS[i]} ${day.getDate()}`;

            return (
              <div
                key={dateKey}
                className={isToday ? "week-day week-day-today" : "week-day"}
                style={{ ["--day-order" as string]: isToday ? -1 : i } as React.CSSProperties}
              >
                <div className="week-day-header">
                  <span className="week-day-label">
                    <span className="week-day-date">{weekdayLabel}</span>
                    {daySecs > 0 && <span className="week-day-total">{hoursLabel(daySecs)}</span>}
                  </span>
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Add time on ${weekdayLabel}`}
                    onClick={() => onAdd(day)}
                  >
                    +
                  </button>
                </div>
                <div className="week-day-cards">
                  {isToday && running && (
                    <div className="entry-card entry-card-running">
                      <div className="entry-card-line1">
                        <span className="mono entry-card-task" title={running.taskName}>
                          {shortTaskName(running.taskName)}
                        </span>
                      </div>
                      <div className="entry-card-line2">running · started {formatTime(running.startedAt)}</div>
                    </div>
                  )}
                  {dayEntries.length === 0 && !(isToday && running) && <p className="week-day-empty">—</p>}
                  {dayEntries.map((entry) => {
                    const locked = !isAdmin && entry.invoiceLocked;
                    const cardProps = locked
                      ? {}
                      : {
                          role: "button" as const,
                          tabIndex: 0,
                          onClick: () => onEdit(entry),
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === "Enter") onEdit(entry);
                          },
                        };
                    return (
                      <div
                        key={entry.id}
                        className={locked ? "entry-card entry-card-locked" : "entry-card"}
                        title={cardTitle(entry)}
                        {...cardProps}
                      >
                        {/* Row 1: ellipsized task name + delete pinned right.
                            The badge lives on its own row below so it can
                            never displace the name in these ~110px columns. */}
                        <div className="entry-card-line1">
                          <button
                            type="button"
                            className="task-name-link mono entry-card-task"
                            onClick={(e) => {
                              e.stopPropagation();
                              onTaskClick(entry);
                            }}
                          >
                            {shortTaskName(entry.taskName)}
                          </button>
                          {/* Corner overlay, hover-revealed: ▶ resumes the
                              task (allowed even on locked entries — a new
                              session is a new, uninvoiced entry), × deletes.
                              ▶ takes the corner slot; × sits beside it. */}
                          <button
                            type="button"
                            className="btn-icon entry-card-restart"
                            aria-label={`Start timer for ${entry.taskName}`}
                            title="Start again"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartAgain(entry.taskName);
                            }}
                          >
                            ▶
                          </button>
                          {!locked && (
                            <button
                              type="button"
                              className="btn-icon entry-card-delete"
                              aria-label="Delete entry"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm("Delete this entry?")) onDelete(entry.id);
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <div className="entry-card-line2">
                          {entry.durationSecs != null ? hoursLabel(entry.durationSecs) : "—"}
                          {(entry.taskLink || entry.taskDetails) && (
                            <span className="entry-card-indicators">
                              {entry.taskLink && (
                                <a
                                  className="task-link-icon"
                                  href={entry.taskLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label="Task link"
                                  title={entry.taskLink}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ↗
                                </a>
                              )}
                              {entry.taskDetails && (
                                <span
                                  className="entry-card-details-icon"
                                  aria-label="Task details"
                                  title={entry.taskDetails}
                                >
                                  ≡
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {entry.taskStatus !== "open" && (
                          <div className="entry-card-line3" onClick={(e) => e.stopPropagation()}>
                            <StatusBadge status={entry.taskStatus} taskId={entry.taskId} onSaved={onStatusSaved} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
