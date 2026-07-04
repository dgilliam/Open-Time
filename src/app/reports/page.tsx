"use client";

// Presets (This week / Last week / This month) + custom range, hours-by-task
// table. Admins can switch person or group by user instead of task.

import { useEffect, useState } from "react";
import { getReport, listUsers } from "@/lib/api";
import {
  addDays,
  dateInputValue,
  formatReportDates,
  hoursLabel,
  parseLocalDate,
  startOfMonth,
  startOfWeek,
  toIso,
} from "@/lib/format";
import type { ReportResult, User } from "@/lib/types";
import { useSession } from "@/components/SessionContext";
import { UserSelect } from "@/components/UserSelect";

type Preset = "this-week" | "last-week" | "this-month" | "last-30" | "custom";
type GroupBy = "task" | "user";

function presetRange(preset: Preset, customFrom: string, customTo: string): { from: Date; to: Date } {
  const today = new Date();
  if (preset === "this-week") {
    const monday = startOfWeek(today);
    return { from: monday, to: addDays(monday, 6) };
  }
  if (preset === "last-week") {
    const monday = addDays(startOfWeek(today), -7);
    return { from: monday, to: addDays(monday, 6) };
  }
  if (preset === "this-month") {
    const start = startOfMonth(today);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return { from: start, to: end };
  }
  if (preset === "last-30") {
    // Rolling window: unlike the calendar presets, this is always cumulative
    // and never loses tasks across a week/month boundary.
    const start = addDays(today, -29);
    return { from: new Date(start.getFullYear(), start.getMonth(), start.getDate()), to: today };
  }
  return { from: parseLocalDate(customFrom), to: parseLocalDate(customTo) };
}

export default function ReportsPage() {
  const { user } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("task");
  const [preset, setPreset] = useState<Preset>("this-week");
  const [customFrom, setCustomFrom] = useState(dateInputValue(startOfWeek(new Date())));
  const [customTo, setCustomTo] = useState(dateInputValue(addDays(startOfWeek(new Date()), 6)));
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setSelectedUserId(user.id);
    if (user.role === "admin") {
      listUsers()
        .then(setUsers)
        .catch(() => setUsers([]));
    }
  }, [user]);

  useEffect(() => {
    if (!selectedUserId) return;
    const { from, to } = presetRange(preset, customFrom, customTo);
    const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
    setError(null);
    getReport({
      userId: groupBy === "task" ? selectedUserId : undefined,
      from: toIso(from),
      to: toIso(toEnd),
      groupBy,
    })
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load report"));
  }, [selectedUserId, groupBy, preset, customFrom, customTo]);

  if (!user) return null;

  return (
    <div className="page">
      <h1>Reports</h1>
      <div className="toolbar">
        <div className="preset-group">
          {(["this-week", "last-week", "this-month", "last-30"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={preset === p ? "btn btn-preset active" : "btn btn-preset"}
              onClick={() => setPreset(p)}
            >
              {p === "this-week"
                ? "This week"
                : p === "last-week"
                ? "Last week"
                : p === "this-month"
                ? "This month"
                : "Last 30 days"}
            </button>
          ))}
        </div>
        <label className="inline-label">
          From
          <input
            type="date"
            value={customFrom}
            onChange={(e) => {
              setCustomFrom(e.target.value);
              setPreset("custom");
            }}
          />
        </label>
        <label className="inline-label">
          To
          <input
            type="date"
            value={customTo}
            onChange={(e) => {
              setCustomTo(e.target.value);
              setPreset("custom");
            }}
          />
        </label>
        {user.role === "admin" && (
          <>
            {groupBy === "task" && (
              <UserSelect users={users} value={selectedUserId} onChange={setSelectedUserId} />
            )}
            <label className="inline-label">
              Group by
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="task">Task</option>
                <option value="user">User</option>
              </select>
            </label>
          </>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{groupBy === "task" ? "Task" : "User"}</th>
                {groupBy === "task" && <th>Dates</th>}
                <th className="num">Hours</th>
              </tr>
            </thead>
            <tbody>
              {result.groups.map((g) => (
                <tr key={g.id}>
                  <td className={groupBy === "task" ? "mono" : undefined}>{g.name}</td>
                  {groupBy === "task" && <td className="muted">{formatReportDates(g.dates)}</td>}
                  <td className="num">{hoursLabel(g.hours * 3600)}</td>
                </tr>
              ))}
              {result.groups.length === 0 && (
                <tr>
                  <td colSpan={groupBy === "task" ? 3 : 2} className="muted">
                    No entries in this range.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {groupBy === "task" && <td></td>}
                <td className="num">{hoursLabel(result.totalHours * 3600)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
