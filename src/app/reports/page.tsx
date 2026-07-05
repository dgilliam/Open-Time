"use client";

// Presets (This week / Last week / This month) + custom range, hours-by-task
// table. Admins can switch person or group by user instead of task.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getReport, listUsers, reportsCsvUrl } from "@/lib/api";
import {
  addDays,
  dateInputValue,
  formatReportDates,
  hoursLabel,
  parseLocalDate,
  pluralCount,
  startOfMonth,
  startOfWeek,
  toIso,
} from "@/lib/format";
import type { ReportGroup, ReportResult, TaskStatus, User } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { TaskWrapUpDialog } from "@/components/TaskWrapUpDialog";
import { useSession } from "@/components/SessionContext";
import { UserSelect } from "@/components/UserSelect";
import { useSortable, type SortableColumn } from "@/components/useSortable";
import { SortTh } from "@/components/SortTh";

// Click-to-sort column configs for the two /reports groupings (docs/PLAN.md
// v2.6/T22 addendum) — same shared useSortable hook and text-asc/numeric-
// desc-first convention as the dashboard. Default (API recency) order is
// preserved until a header is clicked; useSortable passes rows through
// untouched until then.
const TASK_GROUP_COLUMNS: Record<string, SortableColumn<ReportGroup>> = {
  task: { accessor: (g) => g.name, defaultDir: "asc" },
  status: { accessor: (g) => g.status ?? "open", defaultDir: "asc" },
  dates: { accessor: (g) => g.lastWorked ?? "", defaultDir: "desc" },
  hours: { accessor: (g) => g.hours, defaultDir: "desc" },
};
const USER_GROUP_COLUMNS: Record<string, SortableColumn<ReportGroup>> = {
  user: { accessor: (g) => g.name, defaultDir: "asc" },
  project: { accessor: (g) => g.project ?? "", defaultDir: "asc" },
  tasks: { accessor: (g) => g.taskCount ?? 0, defaultDir: "desc" },
  hours: { accessor: (g) => g.hours, defaultDir: "desc" },
};
function groupTiebreak(a: ReportGroup, b: ReportGroup) {
  return a.name.localeCompare(b.name);
}

/** Shared shape for opening TaskWrapUpDialog from the task-grouping table (v2.6/T20). */
interface WrapUpTarget {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  link: string | null;
  details: string | null;
}

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

/**
 * The exact ISO range the report fetch (and the CSV export link) use — a
 * single source of truth so the two can never drift apart. `to` is bumped
 * to the end of its calendar day so a same-day range isn't empty.
 */
function activeIsoRange(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const { from, to } = presetRange(preset, customFrom, customTo);
  const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
  return { from: toIso(from), to: toIso(toEnd) };
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
  const [wrapUp, setWrapUp] = useState<WrapUpTarget | null>(null);

  useEffect(() => {
    if (!user) return;
    setSelectedUserId(user.id);
    if (user.role === "admin") {
      listUsers()
        .then(setUsers)
        .catch(() => setUsers([]));
    }
  }, [user]);

  const loadReport = useCallback(async () => {
    if (!selectedUserId) return;
    const { from, to } = activeIsoRange(preset, customFrom, customTo);
    setError(null);
    try {
      const rep = await getReport({
        userId: groupBy === "task" ? selectedUserId : undefined,
        from,
        to,
        groupBy,
      });
      setResult(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load report");
    }
  }, [selectedUserId, groupBy, preset, customFrom, customTo]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  // Separate useSortable instances per grouping (task vs. user) — each only
  // ever receives rows for its own grouping, so switching groupBy naturally
  // resets the other's inactive state without extra plumbing. Rows are
  // passed through untouched (API recency order) until a header is clicked.
  const taskGroupRows = useMemo(
    () => (groupBy === "task" ? result?.groups ?? [] : []),
    [groupBy, result]
  );
  const userGroupRows = useMemo(
    () => (groupBy === "user" ? result?.groups ?? [] : []),
    [groupBy, result]
  );
  const taskSort = useSortable(taskGroupRows, TASK_GROUP_COLUMNS, groupTiebreak);
  const userSort = useSortable(userGroupRows, USER_GROUP_COLUMNS, groupTiebreak);
  const sortedGroups = groupBy === "task" ? taskSort.sorted : userSort.sorted;

  if (!user) return null;

  // Same rule the API uses: task grouping targets the viewed user (self for
  // members, the selected person for admin); user grouping is admin-only and
  // always cross-team ("all"). Reuses activeIsoRange so the link's range can
  // never drift from what the table above is showing.
  const { from: csvFrom, to: csvTo } = activeIsoRange(preset, customFrom, customTo);
  const csvHref = reportsCsvUrl({
    userId: groupBy === "task" ? selectedUserId : "all",
    from: csvFrom,
    to: csvTo,
  });

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
              onClick={() => {
                setPreset(p);
                // Keep the From/To boxes truthful: they always display the
                // active range, not just the last custom values.
                const { from, to } = presetRange(p, customFrom, customTo);
                setCustomFrom(dateInputValue(from));
                setCustomTo(dateInputValue(to));
              }}
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
        <a className="btn" href={csvHref}>
          Export CSV
        </a>
      </div>
      {error && <p className="error-text">{error}</p>}
      {result && (
        <>
          <div className="table-count">
            {groupBy === "task"
              ? pluralCount(result.groups.length, "task")
              : `${pluralCount(result.groups.length, "user")} · ${pluralCount(result.distinctTaskCount, "task")}`}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                {groupBy === "task" ? (
                  <tr>
                    <SortTh label="Task" sortKey="task" controller={taskSort} />
                    <SortTh label="Status" sortKey="status" controller={taskSort} />
                    <SortTh label="Dates" sortKey="dates" controller={taskSort} />
                    <SortTh label="Hours" sortKey="hours" controller={taskSort} numeric />
                  </tr>
                ) : (
                  <tr>
                    <SortTh label="User" sortKey="user" controller={userSort} />
                    <SortTh label="Project" sortKey="project" controller={userSort} />
                    <SortTh label="Tasks" sortKey="tasks" controller={userSort} numeric />
                    <SortTh label="Hours" sortKey="hours" controller={userSort} numeric />
                  </tr>
                )}
              </thead>
              <tbody>
                {sortedGroups.map((g) => (
                  <tr key={g.id}>
                    {groupBy === "task" ? (
                      <td className="mono">
                        <button
                          type="button"
                          className="task-name-link"
                          onClick={() =>
                            setWrapUp({
                              taskId: g.id,
                              taskName: g.name,
                              status: g.status ?? "open",
                              link: g.link ?? null,
                              details: g.details ?? null,
                            })
                          }
                        >
                          {g.name}
                        </button>
                        {g.link && (
                          <a
                            className="task-link-icon"
                            href={g.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Task link"
                          >
                            ↗
                          </a>
                        )}
                      </td>
                    ) : (
                      <td>{g.name}</td>
                    )}
                    {groupBy === "task" && (
                      <td>
                        <StatusBadge
                          status={g.status ?? "open"}
                          taskId={g.id}
                          onSaved={loadReport}
                          onError={(message) => setError(message)}
                        />
                      </td>
                    )}
                    {groupBy === "user" && <td className="muted">{g.project ?? "—"}</td>}
                    {groupBy === "task" ? (
                      <td className="muted">{formatReportDates(g.dates)}</td>
                    ) : (
                      <td className="num">{g.taskCount ?? 0}</td>
                    )}
                    <td className="num">{hoursLabel(g.hours * 3600)}</td>
                  </tr>
                ))}
                {sortedGroups.length === 0 && (
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
                  {groupBy === "user" && <td></td>}
                  {groupBy === "task" ? (
                    <>
                      <td></td>
                      <td></td>
                    </>
                  ) : (
                    // Distinct across the team, not the per-user sum (people share tasks).
                    <td className="num">{result.distinctTaskCount}</td>
                  )}
                  <td className="num">{hoursLabel(result.totalHours * 3600)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {wrapUp && (
        <TaskWrapUpDialog
          taskId={wrapUp.taskId}
          taskName={wrapUp.taskName}
          status={wrapUp.status}
          link={wrapUp.link}
          details={wrapUp.details}
          onClose={() => setWrapUp(null)}
          onSaved={() => {
            setWrapUp(null);
            loadReport();
          }}
        />
      )}
    </div>
  );
}
