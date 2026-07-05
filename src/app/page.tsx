"use client";

// Timer + day navigator: task combobox / Start-Stop hero, plus the viewed
// day's completed entries with edit/delete/add and the task wrap-up dialog
// (v2.6). AppShell guarantees a signed-in user by the time this renders.

import { useCallback, useEffect, useState } from "react";
import { ApiError, deleteEntry, getRunningEntry, listEntries, startTimer, stopTimer } from "@/lib/api";
import { addDays, pluralCount, startOfDay, toIso } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { DayNav } from "@/components/DayNav";
import { EntryDialog } from "@/components/EntryDialog";
import { EntryList } from "@/components/EntryList";
import { TaskWrapUpDialog } from "@/components/TaskWrapUpDialog";
import { TimerBar } from "@/components/TimerBar";

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
  const [day, setDay] = useState<Date>(() => startOfDay(new Date()));
  const [dayEntries, setDayEntries] = useState<TimeEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [wrapUp, setWrapUp] = useState<TimeEntry | null>(null);
  const [ready, setReady] = useState(false);

  const loadDay = useCallback(async (viewedDay: Date) => {
    const from = toIso(startOfDay(viewedDay));
    const to = toIso(addDays(startOfDay(viewedDay), 1));
    const entries = await listEntries({ from, to });
    setDayEntries(entries.filter((e) => e.stoppedAt !== null));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [runningEntry] = await Promise.all([getRunningEntry(), loadDay(day)]);
        setRunning(runningEntry);
      } finally {
        setReady(true);
      }
    })();
    // Only run once on mount for the running-timer fetch; day changes are
    // handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    loadDay(day);
  }, [day, ready, loadDay]);

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      const entry = await startTimer({ task: taskInput });
      setRunning(entry);
      setTaskInput("");
      await loadDay(day);
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
      await loadDay(day);
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
    await loadDay(day);
  }

  if (!ready) return null;

  return (
    <div className="page">
      <h1>Timer</h1>
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
      <section className="section">
        <h2>
          Entries <span className="table-count">{pluralCount(dayEntries.length, "entry", "entries")}</span>
        </h2>
        <div className="toolbar">
          <DayNav day={day} onChange={setDay} />
          <button type="button" className="btn" onClick={() => setAdding(true)}>
            + Add time
          </button>
        </div>
        <EntryList
          entries={dayEntries}
          onEdit={setEditing}
          onDelete={handleDelete}
          onTaskClick={(entry) => setWrapUp(entry)}
          onStatusSaved={() => loadDay(day)}
        />
      </section>
      {editing && (
        <EntryDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadDay(day);
          }}
        />
      )}
      {adding && (
        <EntryDialog
          createDefaults={defaultAddTimeRange(day)}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            loadDay(day);
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
            loadDay(day);
          }}
        />
      )}
    </div>
  );
}
