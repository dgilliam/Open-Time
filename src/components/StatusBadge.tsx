// Small status pill for task wrap-up metadata (v2.6 section B). Uses
// color-mix soft backgrounds (same approach as the calendar heatmap) so it
// reads correctly in both light and dark themes.

import type { TaskStatus } from "@/lib/types";

const LABELS: Record<TaskStatus, string> = {
  open: "Open",
  submitted: "Submitted",
  accepted: "Accepted",
  dead_end: "Dead end",
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`status-badge status-badge-${status.replace("_", "-")}`}>{LABELS[status]}</span>
  );
}
