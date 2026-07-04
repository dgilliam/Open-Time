"use client";

import { useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { Project, TimeEntry } from "@/lib/types";
import { durationSeconds, formatTime, hoursLabel } from "@/lib/format";
import { ColorDot } from "./ColorDot";
import { EntryDialog } from "./EntryDialog";

export function EntryList({
  entries,
  projects,
  onChanged,
}: {
  entries: TimeEntry[];
  projects: Project[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(entry: TimeEntry) {
    if (!confirm(`Delete this entry${entry.note ? ` ("${entry.note}")` : ""}?`)) return;
    setBusyId(entry.id);
    setError(null);
    try {
      await api.deleteEntry(entry.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  if (entries.length === 0) {
    return <p className="muted">No entries yet today.</p>;
  }

  return (
    <>
      {error && <p className="error-text">{error}</p>}
      <table className="entry-table">
        <thead>
          <tr>
            <th>Project</th>
            <th>Note</th>
            <th>Start</th>
            <th>Stop</th>
            <th className="num">Duration</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <span className="project-cell">
                  <ColorDot color={entry.projectColor} />
                  {entry.projectName}
                </span>
              </td>
              <td>{entry.note || <span className="muted">—</span>}</td>
              <td>{formatTime(entry.startedAt)}</td>
              <td>{entry.stoppedAt ? formatTime(entry.stoppedAt) : <span className="muted">running</span>}</td>
              <td className="num">{hoursLabel(durationSeconds(entry.startedAt, entry.stoppedAt))}</td>
              <td className="row-actions">
                <button type="button" className="btn-link" onClick={() => setEditing(entry)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-link btn-link-danger"
                  onClick={() => handleDelete(entry)}
                  disabled={busyId === entry.id}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <EntryDialog
          entry={editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </>
  );
}
