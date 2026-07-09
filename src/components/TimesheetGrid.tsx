"use client";

// v3.1: the retired /timesheet page (solidtime-style weekly grid) returns as
// a third Week-page mode. One row per task with completed entries in the
// viewed week (plus manually added rows), Sun-first day columns, editable
// cells that replace a task+day's completed entries with a single synthetic
// 09:00-local entry via PUT /api/timesheet/cell (kept alive through v3.0
// precisely so this view could come back). Self-only data; running entries
// are never touched or counted here.
//
// Unlike the old standalone page this component doesn't own its data: the
// Week page passes the same completed-entry list WeekGrid renders, and cell
// saves call `onChanged` so the parent refetches once for every mode.

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, setTimesheetCell as setTimesheetCellApi } from "@/lib/api";
import {
  addDays,
  dateInputValue,
  formatHoursMinutes,
  formatShortDate,
  hoursLabel,
  isoWeekNumber,
  pluralCount,
  startOfWeekSun,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { TaskCombobox } from "@/components/TaskCombobox";
import { useSession } from "@/components/SessionContext";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Row {
  key: string;
  displayName: string;
  secsByDate: Map<string, number>;
  // v2.8: dates whose completed entries for this task include at least one
  // invoice-locked entry. Cells rendered inert (no editor) when the viewer
  // is a member; admins bypass (same rule as EntryList/the API).
  lockedDates: Set<string>;
  // First real entry backing this row (every entry in a row shares the same
  // task), used to open the wrap-up dialog. Manually-added rows with no
  // entries yet have none and render as plain (non-clickable) text.
  refEntry?: TimeEntry;
}

/**
 * Approximate mirror of the server's task-identity matching, used only to
 * dedupe rows client-side. Server identity is case-insensitive for both slug
 * and free-text tasks, so this just trims, collapses whitespace, and
 * lowercases the whole name.
 */
function normalizeKey(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Trims a decimal hours value for display in the edit input, e.g. 3 -> "3", 3.5 -> "3.5". */
function trimHours(hours: number): string {
  const fixed = hours.toFixed(2);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

/** Parses "3", "3.5", "3:30", or "3h 30m" into decimal hours; null if unrecognized. Empty string means clear (0). */
function parseHoursInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;

  let m = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (m) return Number(m[1]) + Number(m[2]) / 60;

  m = trimmed.match(/^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+)\s*m)?$/i);
  if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);

  m = trimmed.match(/^\d+(?:\.\d+)?$/);
  if (m) return Number(trimmed);

  return null;
}

export function TimesheetGrid({
  weekStart,
  onWeekStartChange,
  entries,
  onTaskClick,
  onChanged,
}: {
  /** Sunday (local midnight) of the viewed week. */
  weekStart: Date;
  onWeekStartChange: (weekStart: Date) => void;
  /** Completed entries (stoppedAt !== null) within the viewed week's range. */
  entries: TimeEntry[];
  /** Opens the task wrap-up dialog for a row's task. */
  onTaskClick: (entry: TimeEntry) => void;
  /** Refetch callback after a cell save. */
  onChanged: () => Promise<void> | void;
}) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const [extraRows, setExtraRows] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ rowKey: string; dateKey: string; value: string; error?: boolean } | null>(
    null
  );
  const [addingRow, setAddingRow] = useState(false);
  const [newRowTask, setNewRowTask] = useState("");
  const cancelRef = useRef(false);

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart]);
  const dateKeys = useMemo(() => days.map(dateInputValue), [days]);

  // Reset the once-per-week UI state (added rows, in-flight edit) on nav.
  useEffect(() => {
    setExtraRows([]);
    setEditing(null);
    setAddingRow(false);
  }, [weekStart]);

  const rows: Row[] = useMemo(() => {
    const grouped = new Map<string, Row>();
    for (const e of entries) {
      const key = normalizeKey(e.taskName);
      let row = grouped.get(key);
      if (!row) {
        row = {
          key,
          displayName: e.taskName,
          secsByDate: new Map(),
          lockedDates: new Set(),
          refEntry: e,
        };
        grouped.set(key, row);
      }
      const dateKey = dateInputValue(new Date(e.startedAt));
      row.secsByDate.set(dateKey, (row.secsByDate.get(dateKey) ?? 0) + (e.durationSecs ?? 0));
      if (e.invoiceLocked) row.lockedDates.add(dateKey);
    }
    for (const name of extraRows) {
      const key = normalizeKey(name);
      if (!grouped.has(key)) {
        grouped.set(key, { key, displayName: name, secsByDate: new Map(), lockedDates: new Set() });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [entries, extraRows]);

  const totalsByDate = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of entries) {
      const dateKey = dateInputValue(new Date(e.startedAt));
      totals.set(dateKey, (totals.get(dateKey) ?? 0) + (e.durationSecs ?? 0));
    }
    return totals;
  }, [entries]);

  const weekTotalSecs = entries.reduce((sum, e) => sum + (e.durationSecs ?? 0), 0);

  const monday = addDays(weekStart, 1);
  const weekNum = isoWeekNumber(monday);
  const isThisWeek = dateInputValue(weekStart) === dateInputValue(startOfWeekSun(new Date()));
  const label = isThisWeek
    ? `This week · W${weekNum}`
    : `${formatShortDate(weekStart)} – ${formatShortDate(addDays(weekStart, 6))} · W${weekNum}`;

  async function saveCell(row: Row, dateKey: string, rawValue: string, inputEl?: HTMLInputElement) {
    const parsed = parseHoursInput(rawValue);
    if (parsed === null || parsed > 24) {
      setError("Enter hours like 3, 3.5, 3:30, or 3h 30m (max 24).");
      setEditing((prev) =>
        prev && prev.rowKey === row.key && prev.dateKey === dateKey ? { ...prev, error: true } : prev
      );
      if (inputEl) {
        requestAnimationFrame(() => inputEl.focus());
      }
      return;
    }
    setEditing(null);
    setError(null);
    try {
      await setTimesheetCellApi({ task: row.displayName, date: dateKey, hours: parsed });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to save cell");
    }
  }

  function commitAddRow() {
    const trimmed = newRowTask.trim();
    if (trimmed) {
      const key = normalizeKey(trimmed);
      const alreadyThere = rows.some((r) => r.key === key);
      if (!alreadyThere) setExtraRows((prev) => [...prev, trimmed]);
    }
    setNewRowTask("");
    setAddingRow(false);
  }

  return (
    <section className="section">
      <div className="toolbar timesheet-toolbar">
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
      {error && <p className="error-text">{error}</p>}
      <div className="table-count">{pluralCount(rows.length, "task")}</div>
      <div className="table-scroll">
        <table className="timesheet-table">
          <thead>
            <tr>
              <th>Task</th>
              {days.map((d, i) => (
                <th key={dateKeys[i]} className="num">
                  {WEEKDAY_LABELS[i]} {d.getDate()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No entries this week yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="mono">
                  {row.refEntry ? (
                    <button type="button" className="task-name-link" onClick={() => onTaskClick(row.refEntry!)}>
                      {row.displayName}
                    </button>
                  ) : (
                    row.displayName
                  )}
                </td>
                {dateKeys.map((dateKey) => {
                  const secs = row.secsByDate.get(dateKey) ?? 0;
                  const isEditing = editing?.rowKey === row.key && editing.dateKey === dateKey;
                  // v2.8: members get an inert, quiet chip for a day whose
                  // entries include a locked invoiced one — no click, no
                  // message. Admins bypass (same rule as the API/EntryList).
                  const locked = !isAdmin && row.lockedDates.has(dateKey);
                  return (
                    <td key={dateKey} className="num timesheet-cell">
                      {locked ? (
                        <span className="timesheet-chip timesheet-chip-locked" aria-disabled="true">
                          {secs > 0 ? formatHoursMinutes(secs) : "-"}
                        </span>
                      ) : isEditing ? (
                        <input
                          autoFocus
                          defaultValue={editing.value}
                          className={editing.error ? "timesheet-cell-input cell-input-error" : "timesheet-cell-input"}
                          onChange={(e) => {
                            const raw = e.currentTarget.value;
                            const sanitized = raw.replace(/[^0-9:.hm\s]/gi, "");
                            if (sanitized !== raw) {
                              e.currentTarget.value = sanitized;
                            }
                            if (editing?.error) {
                              setError(null);
                              setEditing((prev) => (prev ? { ...prev, error: false } : prev));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            } else if (e.key === "Escape") {
                              cancelRef.current = true;
                              setError(null);
                              setEditing(null);
                            }
                          }}
                          onBlur={(e) => {
                            if (cancelRef.current) {
                              cancelRef.current = false;
                              return;
                            }
                            saveCell(row, dateKey, e.currentTarget.value, e.currentTarget);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={secs > 0 ? "timesheet-chip" : "timesheet-chip empty"}
                          onClick={() => {
                            // A previous Escape-cancel can leave cancelRef set
                            // when React unmounts the input before its blur
                            // fires; without this reset, the stale flag
                            // silently swallows this cell's next save (the
                            // team's "add row doesn't work" bug).
                            cancelRef.current = false;
                            setEditing({ rowKey: row.key, dateKey, value: secs > 0 ? trimHours(secs / 3600) : "" });
                          }}
                        >
                          {secs > 0 ? formatHoursMinutes(secs) : "-"}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {dateKeys.map((dateKey) => (
                <td key={dateKey} className="num">
                  {formatHoursMinutes(totalsByDate.get(dateKey) ?? 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="toolbar timesheet-add-row">
        {addingRow ? (
          <>
            <TaskCombobox value={newRowTask} onChange={setNewRowTask} onSubmit={commitAddRow} autoFocus />
            <button type="button" className="btn" onClick={commitAddRow}>
              Add
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setNewRowTask("");
                setAddingRow(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn-link" onClick={() => setAddingRow(true)}>
            + Add row
          </button>
        )}
      </div>
    </section>
  );
}
