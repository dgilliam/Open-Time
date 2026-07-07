"use client";

// Edit/create dialog for a time entry: task string (combobox) + start/stop
// datetime-local inputs. Shows the API's validation message inline (the
// backend normalizes/validates the task string and re-rounds the duration).
//
// Edit mode: pass `entry`. Create mode (v2.6 section A, "+ Add time"): pass
// `createDefaults` instead — prefilled start/stop for the viewed day, empty
// task via TaskCombobox, saved via POST /api/entries.

import { useState } from "react";
import { ApiError, createEntry, updateEntry } from "@/lib/api";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { Dialog } from "./Dialog";
import { TaskCombobox } from "./TaskCombobox";

export function EntryDialog({
  entry,
  createDefaults,
  onClose,
  onSaved,
}: {
  entry?: TimeEntry;
  createDefaults?: { startedAt: string; stoppedAt: string };
  onClose: () => void;
  onSaved: (entry: TimeEntry) => void;
}) {
  const isCreate = !entry;
  const [task, setTask] = useState(entry?.taskName ?? "");
  const [startedAt, setStartedAt] = useState(
    entry ? toDatetimeLocalValue(entry.startedAt) : createDefaults?.startedAt ?? ""
  );
  const [stoppedAt, setStoppedAt] = useState(
    entry ? (entry.stoppedAt ? toDatetimeLocalValue(entry.stoppedAt) : "") : createDefaults?.stoppedAt ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const saved = isCreate
        ? await createEntry({
            task,
            startedAt: fromDatetimeLocalValue(startedAt),
            stoppedAt: fromDatetimeLocalValue(stoppedAt),
          })
        : await updateEntry(entry.id, {
            task,
            startedAt: fromDatetimeLocalValue(startedAt),
            stoppedAt: stoppedAt ? fromDatetimeLocalValue(stoppedAt) : null,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to save entry");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={isCreate ? "Add time" : "Edit entry"} onClose={onClose} variant="drawer">
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
