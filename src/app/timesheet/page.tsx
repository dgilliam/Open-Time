"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { TimeEntry } from "@/lib/types";
import { useUser } from "@/components/UserContext";
import { ColorDot } from "@/components/ColorDot";
import { addDays, durationSeconds, formatShortDate, hoursLabel, startOfDay, startOfWeek, weekLabel } from "@/lib/format";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface ProjectRow {
  projectId: string;
  name: string;
  color: string;
  days: number[]; // seconds per day, index 0 = Monday
  total: number;
}

export default function TimesheetPage() {
  const { users, userId, user, loading: userLoading } = useUser();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Open-Time — Timesheet";
  }, []);

  const load = useCallback(() => {
    if (!userId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const rangeEnd = addDays(weekStart, 7);
    api
      .listEntries({ userId, from: weekStart.toISOString(), to: rangeEnd.toISOString() })
      .then((list) => setEntries(list))
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [userId, weekStart]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo<ProjectRow[]>(() => {
    const byProject = new Map<string, ProjectRow>();
    for (const entry of entries) {
      const dayIndex = Math.round(
        (startOfDay(new Date(entry.startedAt)).getTime() - weekStart.getTime()) / 86_400_000
      );
      if (dayIndex < 0 || dayIndex > 6) continue; // entry started outside the visible week
      let row = byProject.get(entry.projectId);
      if (!row) {
        row = {
          projectId: entry.projectId,
          name: entry.projectName,
          color: entry.projectColor,
          days: [0, 0, 0, 0, 0, 0, 0],
          total: 0,
        };
        byProject.set(entry.projectId, row);
      }
      const seconds = durationSeconds(entry.startedAt, entry.stoppedAt);
      row.days[dayIndex] += seconds;
      row.total += seconds;
    }
    return Array.from(byProject.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, weekStart]);

  const dayTotals = useMemo(() => {
    const totals = [0, 0, 0, 0, 0, 0, 0];
    for (const row of rows) {
      for (let i = 0; i < 7; i++) totals[i] += row.days[i];
    }
    return totals;
  }, [rows]);

  const grandTotal = dayTotals.reduce((a, b) => a + b, 0);

  if (userLoading) return <p className="muted">Loading…</p>;
  if (!userId) {
    return (
      <p className="muted">
        {users.length === 0
          ? "No team members yet. Add one via POST /api/users to get started."
          : "Pick a user from the top nav to get started."}
      </p>
    );
  }

  return (
    <div className="page">
      <h1>Timesheet</h1>
      <div className="toolbar">
        <button type="button" className="btn" onClick={() => setWeekStart((w) => addDays(w, -7))}>
          ← Prev
        </button>
        <button type="button" className="btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          This week
        </button>
        <button type="button" className="btn" onClick={() => setWeekStart((w) => addDays(w, 7))}>
          Next →
        </button>
        <span className="week-label">
          {weekLabel(weekStart)} {user ? `— ${user.name}` : ""}
        </span>
      </div>
      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No entries this week.</p>
      ) : (
        <div className="table-scroll">
          <table className="timesheet-table">
            <thead>
              <tr>
                <th>Project</th>
                {DAY_LABELS.map((label, i) => (
                  <th key={label}>
                    {label}
                    <div className="muted small">{formatShortDate(addDays(weekStart, i))}</div>
                  </th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.projectId}>
                  <td>
                    <span className="project-cell">
                      <ColorDot color={row.color} />
                      {row.name}
                    </span>
                  </td>
                  {row.days.map((seconds, i) => (
                    <td key={i}>{seconds > 0 ? hoursLabel(seconds) : <span className="muted">–</span>}</td>
                  ))}
                  <td className="strong">{hoursLabel(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="strong">Total</td>
                {dayTotals.map((seconds, i) => (
                  <td key={i} className="strong">
                    {seconds > 0 ? hoursLabel(seconds) : <span className="muted">–</span>}
                  </td>
                ))}
                <td className="strong">{hoursLabel(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
