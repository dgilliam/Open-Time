"use client";

// v3.0 week page: TimerBar unchanged at top; below it, a Sun-first week grid
// (WeekGrid) replaces the old day-navigator + EntryList section. Month mode,
// the /timesheet and /calendar retirements, redirects, and nav copy are T28.
// AppShell guarantees a signed-in user by the time this renders.

import { useCallback, useEffect, useState } from "react";
import { ApiError, deleteEntry, getRunningEntry, listEntries, startTimer, stopTimer } from "@/lib/api";
import { addDays, startOfWeekSun, toIso } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { EntryDialog } from "@/components/EntryDialog";
import { TaskWrapUpDialog } from "@/components/TaskWrapUpDialog";
import { TimerBar } from "@/components/TimerBar";
import { WeekGrid } from "@/components/WeekGrid";

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
