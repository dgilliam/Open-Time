"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { Project, TimeEntry } from "@/lib/types";
import { useUser } from "@/components/UserContext";
import { TimerBar } from "@/components/TimerBar";
import { EntryList } from "@/components/EntryList";
import { addDays, startOfDay } from "@/lib/format";

export default function Home() {
  const { users, userId, user, loading: userLoading } = useUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!userId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const dayStart = startOfDay(new Date());
    const dayEnd = addDays(dayStart, 1);
    Promise.all([
      api.listProjects(),
      api.listEntries({ userId, from: dayStart.toISOString(), to: dayEnd.toISOString() }),
    ])
      .then(([projectList, entryList]) => {
        setProjects(projectList);
        setEntries(entryList);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  if (userLoading) {
    return <p className="muted">Loading…</p>;
  }

  if (!userId) {
    return (
      <p className="muted">
        {users.length === 0
          ? "No team members yet. Use “Add teammate” in the nav to create one."
          : "Pick a user from the top nav to get started."}
      </p>
    );
  }

  // The currently-running entry is shown live in the timer bar above; avoid
  // duplicating it in the completed-entries list below.
  const completedEntries = entries.filter((e) => e.stoppedAt !== null);

  return (
    <div className="page">
      <h1>Timer</h1>
      <TimerBar userId={userId} projects={projects} onChanged={load} />
      <section className="section">
        <h2>Today{user ? ` — ${user.name}` : ""}</h2>
        {error && <p className="error-text">{error}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <EntryList entries={completedEntries} projects={projects} onChanged={load} />
        )}
      </section>
    </div>
  );
}
