"use client";

// Today's completed entries: task, local start-stop times, rounded duration,
// and edit/delete actions. Used on the Timer page.

import { formatTime, hoursLabel } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

export function EntryList({
  entries,
  onEdit,
  onDelete,
}: {
  entries: TimeEntry[];
  onEdit: (entry: TimeEntry) => void;
  onDelete: (id: string) => void;
}) {
  if (entries.length === 0) {
    return <p className="muted">No completed entries yet today.</p>;
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
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="mono">{entry.taskName}</td>
              <td>{formatTime(entry.startedAt)}</td>
              <td>{entry.stoppedAt ? formatTime(entry.stoppedAt) : "—"}</td>
              <td className="num">{entry.durationSecs != null ? hoursLabel(entry.durationSecs) : "—"}</td>
              <td className="row-actions">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
