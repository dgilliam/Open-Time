"use client";

// Edit/create dialog for a time entry: task string (combobox) + start/stop
// datetime-local inputs. Shows the API's validation message inline (the
// backend normalizes/validates the task string and re-rounds the duration).
//
// Edit mode: pass `entry`. Create mode (v2.6 section A, "+ Add time"): pass
// `createDefaults` instead — prefilled start/stop for the viewed day, empty
// task via TaskCombobox, saved via POST /api/entries.
//
// Edit mode also exposes the task's wrap-up fields (status/link/details,
// v2.6 section B) so an entry can be fully groomed in one place. They PATCH
// the task only when actually edited — otherwise switching an entry to a
// different task would silently stamp the old task's metadata onto it. The
// entry saves first so the PATCH targets the (possibly re-pointed) task.

import { useState } from "react";
import { ApiError, createEntry, updateEntry, updateTask } from "@/lib/api";
import { fromDatetimeLocalValue, toDatetimeLocalValue } from "@/lib/format";
import type { TaskStatus, TimeEntry } from "@/lib/types";
import { Dialog } from "./Dialog";
import { TaskCombobox } from "./TaskCombobox";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "accepted", label: "Accepted" },
  { value: "dead_end", label: "Dead end" },
];

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
  const [status, setStatus] = useState<TaskStatus>(entry?.taskStatus ?? "open");
  const [link, setLink] = useState(entry?.taskLink ?? "");
  const [details, setDetails] = useState(entry?.taskDetails ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const wrapUpDirty =
    !isCreate &&
    (status !== (entry.taskStatus ?? "open") ||
      link !== (entry.taskLink ?? "") ||
      details !== (entry.taskDetails ?? ""));

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
      if (wrapUpDirty) {
        await updateTask(saved.taskId, { status, link, details });
      }
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
        {!isCreate && (
          <>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Link
              <input
                type="url"
                placeholder="https://reposcout.slack.com/…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
            <label>
              Details
              <textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
            </label>
          </>
        )}
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
