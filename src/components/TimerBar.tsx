"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { Project, TimeEntry } from "@/lib/types";
import { durationSeconds, formatHms } from "@/lib/format";
import { ColorDot } from "./ColorDot";

export function TimerBar({
  userId,
  projects,
  onChanged,
}: {
  userId: string;
  projects: Project[];
  onChanged: () => void;
}) {
  const [running, setRunning] = useState<TimeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [projectId, setProjectId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .getRunningEntry(userId)
      .then((entry) => setRunning(entry))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (projects.length && !projects.some((p) => p.id === projectId)) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [running]);

  async function handleStart() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const entry = await api.startTimer({ userId, projectId, note: note.trim() });
      setRunning(entry);
      setNote("");
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    setBusy(true);
    setError(null);
    try {
      await api.stopTimer({ userId });
      setRunning(null);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="timer-bar">
        <p className="muted">Loading timer…</p>
      </section>
    );
  }

  return (
    <section className="timer-bar">
      {error && <p className="error-text">{error}</p>}
      {running ? (
        <div className="timer-running">
          <div className="timer-elapsed">{formatHms(durationSeconds(running.startedAt, null, now))}</div>
          <div className="timer-info">
            <div className="timer-project">
              <ColorDot color={running.projectColor} />
              <span>{running.projectName}</span>
            </div>
            {running.note && <div className="timer-note">{running.note}</div>}
          </div>
          <button type="button" className="btn btn-danger" onClick={handleStop} disabled={busy}>
            Stop
          </button>
        </div>
      ) : (
        <div className="timer-idle">
          {projects.length === 0 ? (
            <p className="muted">Create an active project first to start tracking time.</p>
          ) : (
            <>
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="What are you working on?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="timer-note-input"
              />
              <button type="button" className="btn btn-primary" onClick={handleStart} disabled={busy}>
                Start
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
