"use client";

// Timer + today: task combobox / Start-Stop hero, plus today's completed
// entries with edit/delete. AppShell guarantees a signed-in user by the time
// this renders.

import { useCallback, useEffect, useState } from "react";
import { ApiError, deleteEntry, getRunningEntry, listEntries, startTimer, stopTimer } from "@/lib/api";
import { startOfDay, toIso } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { EntryDialog } from "@/components/EntryDialog";
import { EntryList } from "@/components/EntryList";
import { TimerBar } from "@/components/TimerBar";

export default function Home() {
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [ready, setReady] = useState(false);

  const loadToday = useCallback(async () => {
    const from = toIso(startOfDay(new Date()));
    const entries = await listEntries({ from });
    setTodayEntries(entries.filter((e) => e.stoppedAt !== null));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [runningEntry] = await Promise.all([getRunningEntry(), loadToday()]);
        setRunning(runningEntry);
      } finally {
        setReady(true);
      }
    })();
  }, [loadToday]);

  async function handleStart() {
    setError(null);
    setStarting(true);
    try {
      const entry = await startTimer({ task: taskInput });
      setRunning(entry);
      setTaskInput("");
      await loadToday();
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
      await stopTimer();
      setRunning(null);
      await loadToday();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to stop timer");
    } finally {
      setStopping(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteEntry(id);
    await loadToday();
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
        <h2>Today</h2>
        <EntryList entries={todayEntries} onEdit={setEditing} onDelete={handleDelete} />
      </section>
      {editing && (
        <EntryDialog
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            loadToday();
          }}
        />
      )}
    </div>
  );
}
