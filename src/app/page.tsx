"use client";

// v3.0 week page: TimerBar unchanged at top; below it, a Week | Timesheet |
// Month toggle. Week mode = WeekGrid (T27). Timesheet mode (v3.1) revives
// the retired /timesheet grid as a component sharing this page's week state
// and entry data. Month mode reuses MonthCalendar + Heatmap exactly as the
// retired /calendar page did. v3.14: admins get a "Viewing" member picker
// above the mode toggle — the founder never logs time, so this page was
// permanently blank for them. Picking someone else renders their entries in
// all three modes and lets the admin add/edit/delete them (the API already
// allowed that); the timer and "start again" are hidden in that state
// because both act on the CALLER's timer. Toggle state is plain useState, not
// persisted to localStorage: it's a cheap default and nothing in feedback
// asked for cross-visit persistence.
// AppShell guarantees a signed-in user by the time this renders.

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  deleteEntry,
  getRunningEntry,
  listEntries,
  listUsers,
  startTimer,
  stopTimer,
} from "@/lib/api";
import { addDays, dateInputValue, startOfDay, startOfMonth, startOfWeek, startOfWeekSun, toIso } from "@/lib/format";
import type { CalendarDay, TimeEntry, User } from "@/lib/types";
import { EntryDialog } from "@/components/EntryDialog";
import { Heatmap } from "@/components/Heatmap";
import { MonthCalendar } from "@/components/MonthCalendar";
import { TaskWrapUpDialog } from "@/components/TaskWrapUpDialog";
import { TimerBar } from "@/components/TimerBar";
import { TimesheetGrid } from "@/components/TimesheetGrid";
import { WeekGrid } from "@/components/WeekGrid";
import { UserSelect } from "@/components/UserSelect";
import { useSession } from "@/components/SessionContext";

type Mode = "week" | "timesheet" | "month";

function endOfMonthIso(month: Date): string {
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  return toIso(new Date(nextMonth.getTime() - 1));
}

/**
 * Buckets completed entries into per-day hours by the BROWSER's local date —
 * the same rule the week grid uses (v3.4.1). The server's /api/calendar
 * buckets by the SERVER's timezone (UTC on Railway), which pushed
 * late-evening entries onto the next day for anyone west of it, so month
 * mode and the heatmap now bucket client-side instead.
 */
function bucketByLocalDate(entries: TimeEntry[]): CalendarDay[] {
  const byDate = new Map<string, number>();
  for (const e of entries) {
    if (e.durationSecs == null) continue;
    const key = dateInputValue(new Date(e.startedAt));
    byDate.set(key, (byDate.get(key) ?? 0) + e.durationSecs);
  }
  return Array.from(byDate.entries())
    .map(([date, secs]) => ({ date, hours: secs / 3600 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Local 09:00 / 09:30 of `day`, formatted for the <input type="datetime-local"> defaults. */
function defaultAddTimeRange(day: Date): { startedAt: string; stoppedAt: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = day.getFullYear();
  const m = pad(day.getMonth() + 1);
  const d = pad(day.getDate());
  return { startedAt: `${y}-${m}-${d}T09:00:00`, stoppedAt: `${y}-${m}-${d}T09:30:00` };
}

export default function Home() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  // v3.14: whose time this page shows. Defaults to the signed-in user; only
  // an admin can point it at someone else (the API 403s everyone else).
  const [users, setUsers] = useState<User[]>([]);
  const [viewedUserId, setViewedUserId] = useState<string>(() => user?.id ?? "");
  const viewingOther = Boolean(user) && viewedUserId !== user!.id;
  const viewedUser = viewingOther ? users.find((u) => u.id === viewedUserId) ?? null : null;

  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekSun(new Date()));
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [addingDay, setAddingDay] = useState<Date | null>(null);
  const [wrapUp, setWrapUp] = useState<TimeEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("week");
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [monthData, setMonthData] = useState<CalendarDay[]>([]);
  const [heatmapDays, setHeatmapDays] = useState<{ date: Date; hours: number }[]>([]);
  const [heatmapReady, setHeatmapReady] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    listUsers()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, [isAdmin]);

  const loadWeek = useCallback(async (viewedWeekStart: Date) => {
    const from = toIso(viewedWeekStart);
    const rangeEnd = addDays(viewedWeekStart, 6);
    const to = toIso(new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999));
    const entries = await listEntries({ userId: viewedUserId, from, to });
    setWeekEntries(entries.filter((e) => e.stoppedAt !== null));
  }, [viewedUserId]);

  useEffect(() => {
    (async () => {
      try {
        const [runningEntry] = await Promise.all([getRunningEntry(), loadWeek(weekStart)]);
        setRunning(runningEntry);
      } finally {
        setReady(true);
      }
    })();
    // Only run once on mount for the running-timer fetch; week changes are
    // handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadWeek(weekStart);
  }, [weekStart, ready, loadWeek]);

  // Month mode: month grid data, refetched on month navigation and when the
  // viewed member changes, bucketed in the browser so a day means the
  // viewer's day, not the server's (v3.4.1).
  useEffect(() => {
    if (!ready || mode !== "month") return;
    listEntries({ userId: viewedUserId, from: toIso(startOfMonth(month)), to: endOfMonthIso(month) })
      .then((entries) => setMonthData(bucketByLocalDate(entries)))
      .catch(() => setMonthData([]));
  }, [ready, mode, month, viewedUserId]);

  // Switching member invalidates the once-per-visit heatmap.
  useEffect(() => {
    setHeatmapReady(false);
  }, [viewedUserId]);

  // Month mode: heatmap covers the last ~12 months, fetched once on first
  // entry into month mode (not on month navigation).
  useEffect(() => {
    if (!ready || mode !== "month" || heatmapReady) return;
    const today = startOfDay(new Date());
    const rangeEnd = addDays(startOfWeek(today), 6);
    const rangeStart = startOfWeek(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1));
    listEntries({ userId: viewedUserId, from: toIso(rangeStart), to: toIso(rangeEnd) })
      .then((entries) => {
        const byDate = new Map(bucketByLocalDate(entries).map((d) => [d.date, d.hours]));
        const days: { date: Date; hours: number }[] = [];
        for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
          days.push({ date: d, hours: byDate.get(dateInputValue(d)) ?? 0 });
        }
        setHeatmapDays(days);
      })
      .catch(() => setHeatmapDays([]))
      .finally(() => setHeatmapReady(true));
  }, [ready, mode, heatmapReady, viewedUserId]);

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      const entry = await startTimer({ task: taskInput });
      setRunning(entry);
      setTaskInput("");
      await loadWeek(weekStart);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to start timer");
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    setError(null);
    setStopping(true);
    try {
      const stopped = await stopTimer();
      setRunning(null);
      await loadWeek(weekStart);
      // Stopping is never blocked on the wrap-up dialog — the idle UI above
      // is already committed by the time this opens.
      setWrapUp(stopped);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to stop timer");
    } finally {
      setStopping(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteEntry(id);
    await loadWeek(weekStart);
  }

  // "Start again" (v3.2, team feedback): one click on an entry card or
  // timesheet row resumes its task. Swap UX: the server's startTimer
  // auto-stops any running entry in the same transaction — no wrap-up
  // dialog, since the point of the button is switching tasks without
  // ceremony (the stopped entry can be groomed from its card later) — and
  // is an idempotent no-op when that task is already running (v3.2.1), so a
  // stale `running` in this tab can never mint duplicate entries. The local
  // guard is just an optimization that skips the request in the common case.
  const [swapping, setSwapping] = useState(false);
  async function handleStartAgain(taskName: string) {
    if (swapping) return;
    if (running && running.taskName === taskName) return;
    setError(null);
    setSwapping(true);
    try {
      const entry = await startTimer({ task: taskName });
      setRunning(entry);
      await loadWeek(weekStart);
    } catch (err) {
      setRunning(await getRunningEntry().catch(() => null));
      setError(err instanceof ApiError ? err.message : "failed to restart task");
    } finally {
      setSwapping(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="page">
      <h1>Time entry</h1>
      {isAdmin && users.length > 0 && (
        <div className="toolbar">
          <UserSelect users={users} value={viewedUserId} onChange={setViewedUserId} />
          {viewingOther && (
            <span className="muted">
              Showing {viewedUser?.name ?? "this member"}&rsquo;s entries. You can add, edit and delete them;
              the timer and &ldquo;start again&rdquo; are hidden because they run on <em>your</em> clock.
            </span>
          )}
        </div>
      )}
      {!viewingOther && (
        <TimerBar
          running={running}
          taskInput={taskInput}
          onTaskInputChange={setTaskInput}
          onStart={handleStart}
          onStop={handleStop}
          starting={starting}
          stopping={stopping}
          error={error}
        />
      )}
      {viewingOther && error && <p className="error-text">{error}</p>}
      <div className="preset-group">
        <button
          type="button"
          className={mode === "week" ? "btn btn-preset active" : "btn btn-preset"}
          onClick={() => setMode("week")}
        >
          Week
        </button>
        <button
          type="button"
          className={mode === "timesheet" ? "btn btn-preset active" : "btn btn-preset"}
          onClick={() => setMode("timesheet")}
        >
          Timesheet
        </button>
        <button
          type="button"
          className={mode === "month" ? "btn btn-preset active" : "btn btn-preset"}
          onClick={() => setMode("month")}
        >
          Month
        </button>
      </div>
      {mode === "week" && (
        <WeekGrid
          weekStart={weekStart}
          onWeekStartChange={setWeekStart}
          entries={weekEntries}
          running={viewingOther ? null : running}
          onAdd={(day) => setAddingDay(day)}
          onEdit={setEditing}
          onTaskClick={(entry) => setWrapUp(entry)}
          onStatusSaved={() => loadWeek(weekStart)}
          onDelete={handleDelete}
          onStartAgain={viewingOther ? undefined : handleStartAgain}
        />
      )}
      {mode === "timesheet" && (
        <TimesheetGrid
          weekStart={weekStart}
          onWeekStartChange={setWeekStart}
          entries={weekEntries}
          onTaskClick={(entry) => setWrapUp(entry)}
          onChanged={() => loadWeek(weekStart)}
          onStartAgain={viewingOther ? undefined : handleStartAgain}
          forUserId={viewingOther ? viewedUserId : undefined}
        />
      )}
      {mode === "month" && (
        <>
          <MonthCalendar
            month={month}
            data={monthData}
            onPrev={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            onNext={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            onToday={() => setMonth(startOfMonth(new Date()))}
          />
          <section className="section">
            <h2>Activity</h2>
            {heatmapReady && <Heatmap days={heatmapDays} />}
          </section>
        </>
      )}
      {editing && (
        <EntryDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadWeek(weekStart);
          }}
        />
      )}
      {addingDay && (
        <EntryDialog
          createDefaults={defaultAddTimeRange(addingDay)}
          createFor={viewingOther && viewedUser ? { userId: viewedUser.id, userName: viewedUser.name } : undefined}
          onClose={() => setAddingDay(null)}
          onSaved={() => {
            setAddingDay(null);
            loadWeek(weekStart);
          }}
        />
      )}
      {wrapUp && (
        <TaskWrapUpDialog
          taskId={wrapUp.taskId}
          taskName={wrapUp.taskName}
          status={wrapUp.taskStatus}
          link={wrapUp.taskLink}
          details={wrapUp.taskDetails}
          onClose={() => setWrapUp(null)}
          onSaved={() => {
            setWrapUp(null);
            loadWeek(weekStart);
          }}
        />
      )}
    </div>
  );
}
