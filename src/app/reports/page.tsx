"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { Project, ReportResult } from "@/lib/types";
import { ColorDot } from "@/components/ColorDot";
import {
  addDays,
  dateInputValue,
  formatDollars,
  hoursLabel,
  parseLocalDate,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "@/lib/format";

type GroupBy = "project" | "user";

function endOfDayIso(date: Date): string {
  // last millisecond of the given local day, regardless of `date`'s own time-of-day
  return new Date(addDays(startOfDay(date), 1).getTime() - 1).toISOString();
}

export default function ReportsPage() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [from, setFrom] = useState<Date>(() => startOfWeek(new Date()));
  const [to, setTo] = useState<Date>(() => startOfDay(new Date()));
  const [groupBy, setGroupBy] = useState<GroupBy>("project");
  const [result, setResult] = useState<ReportResult | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fromIso = useMemo(() => from.toISOString(), [from]);
  const toIso = useMemo(() => endOfDayIso(to), [to]);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.getReport({ from: fromIso, to: toIso, groupBy }),
      api.listProjects({ includeArchived: true }),
    ])
      .then(([r, p]) => {
        setResult(r);
        setProjects(p);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [fromIso, toIso, groupBy]);

  useEffect(() => {
    load();
  }, [load]);

  const colorByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.color);
    return map;
  }, [projects]);

  function applyPreset(preset: "thisWeek" | "lastWeek" | "thisMonth") {
    if (preset === "thisWeek") {
      setFrom(startOfWeek(today));
      setTo(today);
    } else if (preset === "lastWeek") {
      const lastWeekStart = addDays(startOfWeek(today), -7);
      setFrom(lastWeekStart);
      setTo(addDays(lastWeekStart, 6));
    } else {
      setFrom(startOfMonth(today));
      setTo(today);
    }
  }

  const csvHref = api.reportsCsvUrl({ from: fromIso, to: toIso });
  const grandTotalBillable = result
    ? result.groups.reduce<number | null>((acc, g) => {
        if (g.billableCents === null) return acc;
        return (acc ?? 0) + g.billableCents;
      }, null)
    : null;

  return (
    <div className="page">
      <h1>Reports</h1>

      <div className="toolbar">
        <button type="button" className="btn" onClick={() => applyPreset("thisWeek")}>
          This week
        </button>
        <button type="button" className="btn" onClick={() => applyPreset("lastWeek")}>
          Last week
        </button>
        <button type="button" className="btn" onClick={() => applyPreset("thisMonth")}>
          This month
        </button>
        <label className="inline-label">
          From
          <input
            type="date"
            value={dateInputValue(from)}
            onChange={(e) => setFrom(parseLocalDate(e.target.value))}
          />
        </label>
        <label className="inline-label">
          To
          <input
            type="date"
            value={dateInputValue(to)}
            onChange={(e) => setTo(parseLocalDate(e.target.value))}
          />
        </label>
        <label className="inline-label">
          Group by
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="project">Project</option>
            <option value="user">User</option>
          </select>
        </label>
        <a className="btn" href={csvHref}>
          Export CSV
        </a>
      </div>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : !result || result.groups.length === 0 ? (
        <p className="muted">No entries in this range.</p>
      ) : (
        <table className="entry-table">
          <thead>
            <tr>
              <th>{groupBy === "project" ? "Project" : "User"}</th>
              <th className="num">Hours</th>
              <th className="num">Billable</th>
            </tr>
          </thead>
          <tbody>
            {result.groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <span className="project-cell">
                    {groupBy === "project" && <ColorDot color={colorByProjectId.get(g.id) ?? "#94a3b8"} />}
                    {g.name}
                  </span>
                </td>
                <td className="num">{hoursLabel(g.seconds)}</td>
                <td className="num">{formatDollars(g.billableCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="strong">Total</td>
              <td className="strong num">{hoursLabel(result.totalSeconds)}</td>
              <td className="strong num">{formatDollars(grandTotalBillable)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
