"use client";

// Skippable "Wrap up <task>?" dialog (v2.6 section B): status select, link
// input, details textarea. Opens after a successful timer Stop and from any
// task name click in the Timer page's entry list. Stopping the timer is
// NEVER blocked on this — the caller renders the dialog on top of an already
// idle/updated UI.

import { useState } from "react";
import { ApiError, updateTask } from "@/lib/api";
import type { Task, TaskStatus } from "@/lib/types";
import { Dialog } from "./Dialog";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "open", label: "Keep open" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "accepted", label: "Accepted" },
  { value: "dead_end", label: "Dead end" },
];

export function TaskWrapUpDialog({
  taskId,
  taskName,
  status: initialStatus,
  link: initialLink,
  details: initialDetails,
  onClose,
  onSaved,
}: {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  link: string | null;
  details: string | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  const [status, setStatus] = useState<TaskStatus>(initialStatus);
  const [link, setLink] = useState(initialLink ?? "");
  const [details, setDetails] = useState(initialDetails ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const updated = await updateTask(taskId, {
        status,
        link: link.trim() ? link.trim() : null,
        details: details.trim() ? details.trim() : null,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to save task");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title={`Wrap up?`} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <p className="mono">{taskName}</p>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Link
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://reposcout.slack.com/…"
          />
        </label>
        <label>
          Details
          <textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Skip
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
