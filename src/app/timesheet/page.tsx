"use client";

// Weekly timesheet grid (solidtime-style): Sun-first columns, one row per
// task with completed entries in the viewed week (plus manually added
// rows), editable cells that replace a task+day's completed entries with a
// single synthetic 09:00-local entry. Self-only data; running entries are
// never touched or counted here.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, listEntries, setTimesheetCell as setTimesheetCellApi } from "@/lib/api";
import {
  addDays,
  dateInputValue,
  formatHoursMinutes,
  formatShortDate,
  isoWeekNumber,
  pluralCount,
  startOfWeekSun,
  toIso,
} from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { TaskCombobox } from "@/components/TaskCombobox";
import { useSession } from "@/components/SessionContext";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Row {
  key: string;
  displayName: string;
  secsByDate: Map<string, number>;
}

/** Approximate mirror of the server's task-name normalization, used only to dedupe rows client-side. */
function normalizeKey(raw: string): string {
  const trimmed = raw.trim();
  const dash = trimmed.indexOf("-");
  if (dash < 0) return trimmed.toLowerCase();
  return `${trimmed.slice(0, dash).toUpperCase()}-${trimmed.slice(dash + 1).toLowerCase()}`;
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

export default function TimesheetPage() {
  const { user } = useSession();
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekSun(new Date()));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [extraRows, setExtraRows] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ rowKey: string; dateKey: string; value: string } | null>(null);
  const [addingRow, setAddingRow] = useState(false);
  const [newRowTask, setNewRowTask] = useState("");
  const cancelRef = useRef(false);

  const days = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i)), [weekStart]);
  const dateKeys = useMemo(() => days.map(dateInputValue), [days]);

  const loadWeek = useCallback(async () => {
    const from = toIso(weekStart);
    const rangeEnd = addDays(weekStart, 6);
    const to = toIso(new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999));
    const weekEntries = await listEntries({ from, to });
    setEntries(weekEntries.filter((e) => e.stoppedAt !== null));
  }, [weekStart]);

  useEffect(() => {
    if (!user) return;
    setReady(false);
    loadWeek()
      .catch(() => setEntries([]))
      .finally(() => setReady(true));
  }, [user, loadWeek]);

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
        row = { key, displayName: e.taskName, secsByDate: new Map() };
        grouped.set(key, row);
      }
      const dateKey = dateInputValue(new Date(e.startedAt));
      row.secsByDate.set(dateKey, (row.secsByDate.get(dateKey) ?? 0) + (e.durationSecs ?? 0));
    }
    for (const name of extraRows) {
      const key = normalizeKey(name);
      if (!grouped.has(key)) {
        grouped.set(key, { key, displayName: name, secsByDate: new Map() });
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

  async function saveCell(row: Row, dateKey: string, rawValue: string) {
    const parsed = parseHoursInput(rawValue);
    if (parsed === null) {
      setError("Enter hours like 3, 3.5, 3:30, or 3h 30m.");
      return;
    }
    setEditing(null);
    setError(null);
    try {
      await setTimesheetCellApi({ task: row.displayName, date: dateKey, hours: parsed });
      await loadWeek();
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

  if (!user || !ready) return null;

  return (
    <div className="page">
      <h1>Timesheet</h1>
      <div className="toolbar timesheet-toolbar">
        <button type="button" className="btn" onClick={() => setWeekStart((w) => addDays(w, -7))} aria-label="Previous week">
          ‹
        </button>
        <span className="week-label">{label}</span>
        <button type="button" className="btn" onClick={() => setWeekStart((w) => addDays(w, 7))} aria-label="Next week">
          ›
        </button>
        <span className="week-total">
          Week total <span className="strong">{formatHoursMinutes(weekTotalSecs)}</span>
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
                <td className="mono">{row.displayName}</td>
                {dateKeys.map((dateKey) => {
                  const secs = row.secsByDate.get(dateKey) ?? 0;
                  const isEditing = editing?.rowKey === row.key && editing.dateKey === dateKey;
                  return (
                    <td key={dateKey} className="num timesheet-cell">
                      {isEditing ? (
                        <input
                          autoFocus
                          defaultValue={editing.value}
                          className="timesheet-cell-input"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            } else if (e.key === "Escape") {
                              cancelRef.current = true;
                              setEditing(null);
                            }
                          }}
                          onBlur={(e) => {
                            if (cancelRef.current) {
                              cancelRef.current = false;
                              return;
                            }
                            saveCell(row, dateKey, e.currentTarget.value);
                          }}
                        />
                      ) : (
                        <button
                          type="button"
                          className={secs > 0 ? "timesheet-chip" : "timesheet-chip empty"}
                          onClick={() =>
                            setEditing({ rowKey: row.key, dateKey, value: secs > 0 ? trimHours(secs / 3600) : "" })
                          }
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
    </div>
  );
}
