"use client";

// Edit dialog for a time entry: task string (combobox) + start/stop
// datetime-local inputs. Shows the API's validation message inline (the
// backend normalizes/validates the task string and re-rounds the duration).

import { useState } from "react";
import { ApiError, updateEntry } from "@/lib/api";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { Dialog } from "./Dialog";
import { TaskCombobox } from "./TaskCombobox";

export function EntryDialog({
  entry,
  onClose,
  onSaved,
}: {
  entry: TimeEntry;
  onClose: () => void;
  onSaved: (entry: TimeEntry) => void;
}) {
  const [task, setTask] = useState(entry.taskName);
  const [startedAt, setStartedAt] = useState(toDatetimeLocalValue(entry.startedAt));
  const [stoppedAt, setStoppedAt] = useState(entry.stoppedAt ? toDatetimeLocalValue(entry.stoppedAt) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await updateEntry(entry.id, {
        task,
        startedAt: fromDatetimeLocalValue(startedAt),
        stoppedAt: stoppedAt ? fromDatetimeLocalValue(stoppedAt) : null,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to save entry");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Edit entry" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Task
          <TaskCombobox value={task} onChange={setTask} />
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
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
