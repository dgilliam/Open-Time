// Small status pill for task wrap-up metadata (v2.6 section B). Uses
// color-mix soft backgrounds (same approach as the calendar heatmap) so it
// reads correctly in both light and dark themes.
//
// Interactive mode (v2.6 T21 addendum): pass `taskId` to render the badge as
// a clickable <button> that cycles the task's status in place
// (open -> submitted -> accepted -> dead_end -> open) and saves immediately
// via updateTask. Omit `taskId` for the plain, non-clickable badge (used
// wherever the viewer can't edit the task, or where cycling doesn't apply) —
// its rendering is unchanged from before this addendum.

import { useEffect, useState } from "react";
import { ApiError, updateTask } from "@/lib/api";
import type { TaskStatus } from "@/lib/types";

const LABELS: Record<TaskStatus, string> = {
  open: "Open",
  draft: "Draft",
  submitted: "Submitted",
  accepted: "Accepted",
  dead_end: "Dead end",
};

/** Click-to-cycle order (v2.6 T21 addendum; 'draft' inserted v2.9 section A). */
export const STATUS_CYCLE: TaskStatus[] = ["open", "draft", "submitted", "accepted", "dead_end"];

export function nextStatus(status: TaskStatus): TaskStatus {
  const i = STATUS_CYCLE.indexOf(status);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}

export function StatusBadge({
  status,
  taskId,
  onSaved,
  onError,
}: {
  status: TaskStatus;
  /** Passing a taskId switches the badge into interactive mode. */
  taskId?: string;
  /** Called after a successful PATCH; surfaces should refetch here so the
   * badge ends up reflecting server-authoritative data. */
  onSaved?: () => void;
  /** Called with a message on a failed PATCH (badge already reverted to its
   * previous value). If omitted, the failure is just console-logged. */
  onError?: (message: string) => void;
}) {
  const [displayStatus, setDisplayStatus] = useState(status);
  const [saving, setSaving] = useState(false);

  // Stay in sync when the surface refetches and passes a new status prop.
  useEffect(() => {
    setDisplayStatus(status);
  }, [status]);

  const className = `status-badge status-badge-${displayStatus.replace("_", "-")}`;

  if (!taskId) {
    return <span className={className}>{LABELS[displayStatus]}</span>;
  }

  async function handleClick() {
    const previous = displayStatus;
    const next = nextStatus(previous);
    setDisplayStatus(next);
    setSaving(true);
    try {
      await updateTask(taskId as string, { status: next });
      onSaved?.();
    } catch (err) {
      setDisplayStatus(previous);
      const message = err instanceof ApiError ? err.message : "failed to update task status";
      if (onError) onError(message);
      else console.error("StatusBadge: failed to update status", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <button
      type="button"
      className={`${className} status-badge-interactive`}
      title="Click to change status"
      disabled={saving}
      onClick={handleClick}
    >
      {LABELS[displayStatus]}
    </button>
  );
}
