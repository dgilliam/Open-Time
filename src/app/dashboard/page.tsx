"use client";

// Admin-only dashboard: one shared date-range picker (same presets as
// Reports) drives three sections — Team (stat row + per-contributor table,
// including 0h members), Tasks (consolidated across the whole team, with
// contributors), and Entries (member filter, 200-row cap, Edit/Delete via
// the same EntryDialog used everywhere). Members are redirected to `/`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, deleteEntry, getReport, listEntries, listUsers, reportsCsvUrl } from "@/lib/api";
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
import type { ReportGroup, ReportResult, TaskStatus, TimeEntry, User } from "@/lib/types";
import { EntryDialog } from "@/components/EntryDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { TaskWrapUpDialog } from "@/components/TaskWrapUpDialog";
import { useSession } from "@/components/SessionContext";
import { UserSelect } from "@/components/UserSelect";
import { useSortable, type SortableColumn, type SortController } from "@/components/useSortable";

/** Shared shape for opening TaskWrapUpDialog from any table row (v2.6/T20). */
interface WrapUpTarget {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  link: string | null;
  details: string | null;
}

const ENTRIES_CAP = 200;

interface ContributorRow {
  user: User;
  hours: number;
  activeDays: number;
  lastWorked: string | null;
}

// Column configs for the three dashboard tables' click-to-sort headers
// (docs/PLAN.md v2.2 addendum, 2026-07-05): text columns default asc,
// numeric/date columns default desc on first click.
// Note (v2.5): the Project columns below use an empty-string accessor for
// unassigned rows (per plan), which means unassigned actually sorts FIRST
// on ascending (empty string < any character) rather than last — a plain
// localeCompare has no notion of "last" for a blank value without special-
// casing. Flagged as a known deviation from the plan's literal "unassigned
// sorts last on asc" wording; the plan explicitly OK'd the empty-string
// accessor approach.
const TEAM_COLUMNS: Record<string, SortableColumn<ContributorRow>> = {
  name: { accessor: (r) => r.user.name, defaultDir: "asc" },
  project: { accessor: (r) => r.user.project ?? "", defaultDir: "asc" },
  hours: { accessor: (r) => r.hours, defaultDir: "desc" },
  activeDays: { accessor: (r) => r.activeDays, defaultDir: "desc" },
  lastWorked: { accessor: (r) => r.lastWorked ?? "", defaultDir: "desc" },
};
function teamTiebreak(a: ContributorRow, b: ContributorRow) {
  return a.user.name.localeCompare(b.user.name);
}

const TASK_COLUMNS: Record<string, SortableColumn<ReportGroup>> = {
  task: { accessor: (g) => g.name, defaultDir: "asc" },
  hours: { accessor: (g) => g.hours, defaultDir: "desc" },
  contributors: { accessor: (g) => (g.contributors ?? []).length, defaultDir: "desc" },
  dates: { accessor: (g) => g.lastWorked ?? "", defaultDir: "desc" },
  // Plain status-string accessor (v2.6): asc groups alphabetically
  // (accepted, dead_end, open, submitted) which the plan explicitly OKs.
  status: { accessor: (g) => g.status ?? "open", defaultDir: "asc" },
};
function taskTiebreak(a: ReportGroup, b: ReportGroup) {
  return a.name.localeCompare(b.name);
}

const ENTRY_COLUMNS: Record<string, SortableColumn<TimeEntry>> = {
  member: { accessor: (e) => e.userName, defaultDir: "asc" },
  project: { accessor: (e) => e.userProject ?? "", defaultDir: "asc" },
  task: { accessor: (e) => e.taskName, defaultDir: "asc" },
  date: { accessor: (e) => e.startedAt, defaultDir: "desc" },
  duration: { accessor: (e) => e.durationSecs ?? -1, defaultDir: "desc" },
};
function entryTiebreak(a: TimeEntry, b: TimeEntry) {
  return a.userName.localeCompare(b.userName);
}

/** Clickable th: button + reserved-width ▲/▼ indicator, aria-sort on the active column. */
function SortTh({
  label,
  sortKey,
  controller,
  numeric,
}: {
  label: string;
  sortKey: string;
  controller: SortController;
  numeric?: boolean;
}) {
  return (
    <th className={numeric ? "num sortable" : "sortable"} aria-sort={controller.ariaSort(sortKey)}>
      <button type="button" onClick={() => controller.toggle(sortKey)}>
        {label}
        <span className="sort-indicator">{controller.indicator(sortKey) ?? ""}</span>
      </button>
    </th>
  );
}

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

/**
 * The exact ISO range loadAll's fetches (and the Entries CSV export link)
 * use — a single source of truth so the two can never drift apart, same
 * approach as /reports. `to` is bumped to the end of its calendar day so a
 * same-day range isn't empty.
 */
function activeIsoRange(preset: Preset, customFrom: string, customTo: string): { from: string; to: string } {
  const { from, to } = presetRange(preset, customFrom, customTo);
  const toEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999);
  return { from: toIso(from), to: toIso(toEnd) };
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
  const [projectFilter, setProjectFilter] = useState("all");
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [wrapUp, setWrapUp] = useState<WrapUpTarget | null>(null);
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
    const { from: fromIso, to: toIsoStr } = activeIsoRange(preset, customFrom, customTo);
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

  // Distinct projects among the team, for the Entries "Project" filter — not
  // just projects appearing in the current range's entries, so the option
  // list doesn't shift as the date range changes.
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) if (u.project) set.add(u.project);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [users]);

  const displayedEntries = useMemo(
    () =>
      allEntries.filter((e) => {
        if (entriesFilter !== "all" && e.userId !== entriesFilter) return false;
        if (projectFilter === "none") return !e.userProject;
        if (projectFilter !== "all" && e.userProject !== projectFilter) return false;
        return true;
      }),
    [allEntries, entriesFilter, projectFilter]
  );

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

  const taskRows = useMemo(() => taskReport?.groups ?? [], [taskReport]);

  const teamSort = useSortable(contributorRows, TEAM_COLUMNS, teamTiebreak);
  const taskSort = useSortable(taskRows, TASK_COLUMNS, taskTiebreak);
  const entrySort = useSortable(displayedEntries, ENTRY_COLUMNS, entryTiebreak);
  // Cap applies AFTER sorting, per plan addendum.
  const cappedEntries = entrySort.sorted.slice(0, ENTRIES_CAP);
  const displayedTotalSecs = useMemo(
    () => displayedEntries.reduce((sum, e) => sum + (e.durationSecs ?? 0), 0),
    [displayedEntries]
  );
  const isCapped = entrySort.sorted.length > ENTRIES_CAP;

  const activeContributors = userReport?.groups.filter((g) => g.hours > 0).length ?? 0;

  // Reuses activeIsoRange so the export link's range can never drift from
  // what the Entries table above is showing; project maps the filter's
  // "all"/"none"/label states to the API's absent/"__none__"/label param.
  const { from: csvFrom, to: csvTo } = activeIsoRange(preset, customFrom, customTo);
  const csvHref = reportsCsvUrl({
    userId: entriesFilter,
    from: csvFrom,
    to: csvTo,
    project: projectFilter === "all" ? undefined : projectFilter === "none" ? "__none__" : projectFilter,
  });

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
                    <SortTh label="Name" sortKey="name" controller={teamSort} />
                    <SortTh label="Project" sortKey="project" controller={teamSort} />
                    <SortTh label="Hours" sortKey="hours" controller={teamSort} numeric />
                    <SortTh label="Active days" sortKey="activeDays" controller={teamSort} numeric />
                    <SortTh label="Last worked" sortKey="lastWorked" controller={teamSort} />
                  </tr>
                </thead>
                <tbody>
                  {teamSort.sorted.map((row) => (
                    <tr key={row.user.id}>
                      <td className="strong">{row.user.name}</td>
                      <td className="muted">{row.user.project ?? "—"}</td>
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
                    <td></td>
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
                    <SortTh label="Task" sortKey="task" controller={taskSort} />
                    <SortTh label="Hours" sortKey="hours" controller={taskSort} numeric />
                    <SortTh label="Contributors" sortKey="contributors" controller={taskSort} />
                    <SortTh label="Dates" sortKey="dates" controller={taskSort} />
                    <SortTh label="Status" sortKey="status" controller={taskSort} />
                  </tr>
                </thead>
                <tbody>
                  {taskSort.sorted.map((g) => (
                    <tr key={g.id}>
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
                      <td className="num">{hoursLabel(g.hours * 3600)}</td>
                      <td className="muted">
                        {(g.contributors ?? [])
                          .map((c) => `${c.name} ${hoursLabel(c.hours * 3600)}`)
                          .join(", ") || "—"}
                      </td>
                      <td className="muted">{formatReportDates(g.dates)}</td>
                      <td>
                        <StatusBadge status={g.status ?? "open"} />
                      </td>
                    </tr>
                  ))}
                  {(taskReport?.groups.length ?? 0) === 0 && (
                    <tr>
                      <td colSpan={5} className="muted">
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
              <label className="inline-label">
                Project
                <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
                  <option value="all">All projects</option>
                  {projectOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="none">No project</option>
                </select>
              </label>
              <a className="btn" href={csvHref}>
                Export CSV
              </a>
            </div>
            <div className="table-scroll">
              <table className="entry-table">
                <thead>
                  <tr>
                    <SortTh label="Member" sortKey="member" controller={entrySort} />
                    <SortTh label="Project" sortKey="project" controller={entrySort} />
                    <SortTh label="Task" sortKey="task" controller={entrySort} />
                    <SortTh label="Date" sortKey="date" controller={entrySort} />
                    <th>Start</th>
                    <th>Stop</th>
                    <SortTh label="Duration" sortKey="duration" controller={entrySort} numeric />
                    <th aria-hidden="true"></th>
                  </tr>
                </thead>
                <tbody>
                  {cappedEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.userName}</td>
                      <td className="muted">{entry.userProject ?? "—"}</td>
                      <td className="mono">
                        <button
                          type="button"
                          className="task-name-link"
                          onClick={() =>
                            setWrapUp({
                              taskId: entry.taskId,
                              taskName: entry.taskName,
                              status: entry.taskStatus,
                              link: entry.taskLink,
                              details: entry.taskDetails,
                            })
                          }
                        >
                          {entry.taskName}
                        </button>
                      </td>
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
                      <td colSpan={8} className="muted">
                        No entries in this range.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    {/* Sums every entry matching the member + project + date
                        filters, not just the 200 rendered rows — the count
                        note above explains the difference when the cap is
                        active. */}
                    <td colSpan={6}>Total</td>
                    <td className="num">{hoursLabel(displayedTotalSecs)}</td>
                    <td></td>
                  </tr>
                </tfoot>
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
            loadAll();
          }}
        />
      )}
    </div>
  );
}
