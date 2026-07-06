"use client";

// Completed entries for the viewed day: task, local start-stop times,
// rounded duration, and edit/delete actions. Used on the Timer page. Task
// names are clickable (opens the wrap-up dialog, v2.6 section B) and show a
// status badge when the task's status isn't the default "open" (keeps the
// common case quiet).
//
// v2.8 invoice locking: for a non-admin viewer, entries whose invoice period
// is currently locked render muted with Edit/Delete absent (not disabled —
// per plan, silent and quiet). Admins always keep full edit, since the
// backend lets admins bypass the lock (they're the ones who set it). The
// task name stays clickable either way — wrap-up metadata isn't invoice
// data.

import { formatTime, hoursLabel } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { useSession } from "@/components/SessionContext";

export function EntryList({
  entries,
  onEdit,
  onDelete,
  onTaskClick,
  onStatusSaved,
}: {
  entries: TimeEntry[];
  onEdit: (entry: TimeEntry) => void;
  onDelete: (id: string) => void;
  onTaskClick?: (entry: TimeEntry) => void;
  /** Refetch callback for the status badge (v2.6 T21 addendum); called after
   * a successful in-place status cycle. */
  onStatusSaved?: () => void;
}) {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";

  if (entries.length === 0) {
    return <p className="muted">No completed entries.</p>;
  }

  return (
    <div className="table-scroll">
      <table className="entry-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Start</th>
            <th>Stop</th>
            <th className="num">Duration</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const locked = !isAdmin && entry.invoiceLocked;
            return (
              <tr key={entry.id} className={locked ? "row-locked" : undefined}>
                <td className="mono">
                  {onTaskClick ? (
                    <button type="button" className="task-name-link" onClick={() => onTaskClick(entry)}>
                      {entry.taskName}
                    </button>
                  ) : (
                    entry.taskName
                  )}
                  {entry.taskStatus !== "open" && (
                    <>
                      {" "}
                      <StatusBadge
                        status={entry.taskStatus}
                        taskId={entry.taskId}
                        onSaved={onStatusSaved}
                      />
                    </>
                  )}
                </td>
                <td>{formatTime(entry.startedAt)}</td>
                <td>{entry.stoppedAt ? formatTime(entry.stoppedAt) : "—"}</td>
                <td className="num">{entry.durationSecs != null ? hoursLabel(entry.durationSecs) : "—"}</td>
                <td className="row-actions">
                  {!locked && (
                    <>
                      <button type="button" className="btn-link" onClick={() => onEdit(entry)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-link btn-link-danger"
                        onClick={() => {
                          if (confirm("Delete this entry?")) onDelete(entry.id);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
