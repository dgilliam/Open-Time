"use client";

// Admin-only dashboard: one shared date-range picker (same presets as
// Reports) drives three sections — Team (stat row + per-contributor table,
// including 0h members), Tasks (consolidated across the whole team, with
// contributors), and Entries (member filter, 200-row cap, Edit/Delete via
// the same EntryDialog used everywhere). Members are redirected to `/`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, deleteEntry, getReport, listEntries, listUsers } from "@/lib/api";
import {
  addDays,
  dateInputValue,
  formatReportDates,
  formatShortDate,
  formatTime,
  hoursLabel,
  parseLocalDate,
  pluralCount,
  startOfMonth,
  startOfWeek,
  toIso,
} from "@/lib/format";
import type { ReportResult, TimeEntry, User } from "@/lib/types";
import { EntryDialog } from "@/components/EntryDialog";
import { useSession } from "@/components/SessionContext";
import { UserSelect } from "@/components/UserSelect";

const ENTRIES_CAP = 200;

type Preset = "this-week" | "last-week" | "this-month" | "last-30" | "custom";

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

export default function DashboardPage() {
  const { user } = useSession();
  const router = useRouter();

  const [preset, setPreset] = useState<Preset>("this-week");
  const [customFrom, setCustomFrom] = useState(dateInputValue(startOfWeek(new Date())));
  const [customTo, setCustomTo] = useState(dateInputValue(addDays(startOfWeek(new Date()), 6)));

  const [users, setUsers] = useState<User[]>([]);
  const [userReport, setUserReport] = useState<ReportResult | null>(null);
  const [taskReport, setTaskReport] = useState<ReportResult | null>(null);
  const [allEntries, setAllEntries] = useState<TimeEntry[]>([]);
  const [entriesFilter, setEntriesFilter] = useState("all");
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && user.role !== "admin") router.replace("/");
  }, [user, router]);

  useEffect(() => {
    if (user?.role === "admin") {
      listUsers()
        .then(setUsers)
        .catch(() => setUsers([]));
    }
  }, [user]);

  const loadAll = useCallback(async () => {
    const { from, to } = presetRange(preset, customFrom, customTo);
    const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
    const fromIso = toIso(from);
    const toIsoStr = toIso(toEnd);
    const [userRep, taskRep, entriesList] = await Promise.all([
      getReport({ groupBy: "user", from: fromIso, to: toIsoStr }),
      getReport({ userId: "all", groupBy: "task", from: fromIso, to: toIsoStr }),
      listEntries({ userId: "all", from: fromIso, to: toIsoStr }),
    ]);
    setUserReport(userRep);
    setTaskReport(taskRep);
    setAllEntries(entriesList);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    setError(null);
    loadAll()
      .catch((err) => setError(err instanceof ApiError ? err.message : "failed to load dashboard"))
      .finally(() => setReady(true));
  }, [user, loadAll]);

  const displayedEntries = useMemo(
    () => (entriesFilter === "all" ? allEntries : allEntries.filter((e) => e.userId === entriesFilter)),
    [allEntries, entriesFilter]
  );
  const cappedEntries = displayedEntries.slice(0, ENTRIES_CAP);
  const isCapped = displayedEntries.length > ENTRIES_CAP;

  const contributorRows = useMemo(() => {
    const byUserId = new Map((userReport?.groups ?? []).map((g) => [g.id, g]));
    return users
      .map((u) => {
        const group = byUserId.get(u.id);
        return {
          user: u,
          hours: group?.hours ?? 0,
          activeDays: group?.dates.length ?? 0,
          lastWorked: group?.lastWorked ?? null,
        };
      })
      .sort((a, b) => b.hours - a.hours || a.user.name.localeCompare(b.user.name));
  }, [users, userReport]);

  const activeContributors = userReport?.groups.filter((g) => g.hours > 0).length ?? 0;

  async function handleDeleteEntry(id: string) {
    await deleteEntry(id);
    await loadAll();
  }

  if (!user || user.role !== "admin") return null;

  return (
    <div className="page">
      <h1>Dashboard</h1>
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
      </div>
      {error && <p className="error-text">{error}</p>}

      {ready && (
        <>
          <section className="section">
            <h2>
              Team <span className="table-count">{pluralCount(contributorRows.length, "member")}</span>
            </h2>
            <div className="stat-row">
              <div className="stat-card">
                <div className="stat-value">{hoursLabel((userReport?.totalHours ?? 0) * 3600)}</div>
                <div className="stat-label">Team total hours</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{activeContributors}</div>
                <div className="stat-label">Active contributors</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{allEntries.length}</div>
                <div className="stat-label">Entries</div>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="num">Hours</th>
                    <th className="num">Active days</th>
                    <th>Last worked</th>
                  </tr>
                </thead>
                <tbody>
                  {contributorRows.map((row) => (
                    <tr key={row.user.id}>
                      <td className="strong">{row.user.name}</td>
                      <td className="num">{hoursLabel(row.hours * 3600)}</td>
                      <td className="num">{row.activeDays}</td>
                      <td className="muted">
                        {row.lastWorked ? formatShortDate(parseLocalDate(row.lastWorked)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{hoursLabel((userReport?.totalHours ?? 0) * 3600)}</td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="section">
            <h2>
              Tasks{" "}
              <span className="table-count">{pluralCount(taskReport?.groups.length ?? 0, "task")}</span>
            </h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Task</th>
                    <th className="num">Hours</th>
                    <th>Contributors</th>
                    <th>Dates</th>
                  </tr>
                </thead>
                <tbody>
                  {(taskReport?.groups ?? []).map((g) => (
                    <tr key={g.id}>
                      <td className="mono">{g.name}</td>
                      <td className="num">{hoursLabel(g.hours * 3600)}</td>
                      <td className="muted">
                        {(g.contributors ?? [])
                          .map((c) => `${c.name} ${hoursLabel(c.hours * 3600)}`)
                          .join(", ") || "—"}
                      </td>
                      <td className="muted">{formatReportDates(g.dates)}</td>
                    </tr>
                  ))}
                  {(taskReport?.groups.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No entries in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{hoursLabel((taskReport?.totalHours ?? 0) * 3600)}</td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <section className="section">
            <h2>
              Entries{" "}
              <span className="table-count">
                {isCapped
                  ? `showing ${ENTRIES_CAP} of ${displayedEntries.length} entries`
                  : pluralCount(displayedEntries.length, "entry", "entries")}
              </span>
            </h2>
            <div className="toolbar">
              <UserSelect users={users} value={entriesFilter} onChange={setEntriesFilter} label="Member" includeAll />
            </div>
            <div className="table-scroll">
              <table className="entry-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Task</th>
                    <th>Date</th>
                    <th>Start</th>
                    <th>Stop</th>
                    <th className="num">Duration</th>
                    <th aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {cappedEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.userName}</td>
                      <td className="mono">{entry.taskName}</td>
                      <td className="muted">{formatShortDate(new Date(entry.startedAt))}</td>
                      <td>{formatTime(entry.startedAt)}</td>
                      <td>{entry.stoppedAt ? formatTime(entry.stoppedAt) : "—"}</td>
                      <td className="num">
                        {entry.durationSecs != null ? hoursLabel(entry.durationSecs) : "—"}
                      </td>
                      <td className="row-actions">
                        <button type="button" className="btn-link" onClick={() => setEditing(entry)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-link btn-link-danger"
                          onClick={() => {
                            if (confirm("Delete this entry?")) handleDeleteEntry(entry.id);
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {cappedEntries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No entries in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {editing && (
        <EntryDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadAll();
          }}
        />
      )}
    </div>
  );
}
