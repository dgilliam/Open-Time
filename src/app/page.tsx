"use client";

// v3.0 week page: TimerBar unchanged at top; below it, a Week | Timesheet |
// Month toggle. Week mode = WeekGrid (T27). Timesheet mode (v3.1) revives
// the retired /timesheet grid as a component sharing this page's week state
// and entry data. Month mode reuses MonthCalendar + Heatmap exactly as the
// retired /calendar page did, self-only (no admin person-selector here —
// that stays out of scope per the plan). Toggle state is plain useState, not
// persisted to localStorage: it's a cheap default and nothing in feedback
// asked for cross-visit persistence.
// AppShell guarantees a signed-in user by the time this renders.

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  deleteEntry,
  getCalendar,
  getRunningEntry,
  listEntries,
  startTimer,
  stopTimer,
} from "@/lib/api";
import { addDays, dateInputValue, startOfDay, startOfMonth, startOfWeek, startOfWeekSun, toIso } from "@/lib/format";
import type { CalendarDay, TimeEntry } from "@/lib/types";
import { EntryDialog } from "@/components/EntryDialog";
import { Heatmap } from "@/components/Heatmap";
import { MonthCalendar } from "@/components/MonthCalendar";
import { TaskWrapUpDialog } from "@/components/TaskWrapUpDialog";
import { TimerBar } from "@/components/TimerBar";
import { TimesheetGrid } from "@/components/TimesheetGrid";
import { WeekGrid } from "@/components/WeekGrid";

type Mode = "week" | "timesheet" | "month";

function endOfMonthIso(month: Date): string {
  const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  return toIso(new Date(nextMonth.getTime() - 1));
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

  const loadWeek = useCallback(async (viewedWeekStart: Date) => {
    const from = toIso(viewedWeekStart);
    const rangeEnd = addDays(viewedWeekStart, 6);
    const to = toIso(new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate(), 23, 59, 59, 999));
    const entries = await listEntries({ from, to });
    setWeekEntries(entries.filter((e) => e.stoppedAt !== null));
  }, []);

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

  // Month mode: month grid data, refetched on month navigation. userId
  // omitted — the API defaults to the caller's own id (self-only, matching
  // the retired /calendar page's member behavior with no person-selector).
  useEffect(() => {
    if (!ready || mode !== "month") return;
    getCalendar({ from: toIso(startOfMonth(month)), to: endOfMonthIso(month) })
      .then(setMonthData)
      .catch(() => setMonthData([]));
  }, [ready, mode, month]);

  // Month mode: heatmap covers the last ~12 months, fetched once on first
  // entry into month mode (not on month navigation).
  useEffect(() => {
    if (!ready || mode !== "month" || heatmapReady) return;
    const today = startOfDay(new Date());
    const rangeEnd = addDays(startOfWeek(today), 6);
    const rangeStart = startOfWeek(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1));
    getCalendar({ from: toIso(rangeStart), to: toIso(rangeEnd) })
      .then((data) => {
        const byDate = new Map(data.map((d) => [d.date, d.hours]));
        const days: { date: Date; hours: number }[] = [];
        for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 1)) {
          days.push({ date: d, hours: byDate.get(dateInputValue(d)) ?? 0 });
        }
        setHeatmapDays(days);
      })
      .catch(() => setHeatmapDays([]))
      .finally(() => setHeatmapReady(true));
  }, [ready, mode, heatmapReady]);

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

  if (!ready) return null;

  return (
    <div className="page">
      <h1>Week</h1>
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
          running={running}
          onAdd={(day) => setAddingDay(day)}
          onEdit={setEditing}
          onTaskClick={(entry) => setWrapUp(entry)}
          onStatusSaved={() => loadWeek(weekStart)}
          onDelete={handleDelete}
        />
      )}
      {mode === "timesheet" && (
        <TimesheetGrid
          weekStart={weekStart}
          onWeekStartChange={setWeekStart}
          entries={weekEntries}
          onTaskClick={(entry) => setWrapUp(entry)}
          onChanged={() => loadWeek(weekStart)}
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
