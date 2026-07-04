"use client";

import { useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { Project, TimeEntry } from "@/lib/types";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/format";
import { Dialog } from "./Dialog";

export function EntryDialog({
  entry,
  projects,
  onClose,
  onSaved,
}: {
  entry: TimeEntry;
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectId, setProjectId] = useState(entry.projectId);
  const [note, setNote] = useState(entry.note);
  const [startedAt, setStartedAt] = useState(toDatetimeLocalValue(entry.startedAt));
  const [stoppedAt, setStoppedAt] = useState(entry.stoppedAt ? toDatetimeLocalValue(entry.stoppedAt) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Ensure the entry's current project shows up in the picker even if archived.
  const projectOptions: { id: string; name: string }[] = projects.some((p) => p.id === entry.projectId)
    ? projects
    : [{ id: entry.projectId, name: entry.projectName }, ...projects];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateEntry(entry.id, {
        projectId,
        note,
        startedAt: fromDatetimeLocalValue(startedAt),
        stoppedAt: stoppedAt ? fromDatetimeLocalValue(stoppedAt) : null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Edit entry" onClose={saving ? () => {} : onClose}>
      <form onSubmit={handleSubmit} className="form">
        {error && <p className="error-text">{error}</p>}
        <label>
          Project
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label>
          Start
          <input
            type="datetime-local"
            step="1"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            required
          />
        </label>
        <label>
          Stop
          <input
            type="datetime-local"
            step="1"
            value={stoppedAt}
            onChange={(e) => setStoppedAt(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
