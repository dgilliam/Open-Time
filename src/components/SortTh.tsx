"use client";

// Shared clickable table header: button + reserved-width ▲/▼ indicator,
// aria-sort on the active column. Extracted from the dashboard (T22) so
// /reports can reuse the same click-to-sort pattern via useSortable.

import type { SortController } from "@/components/useSortable";

export function SortTh({
  label,
  sortKey,
  controller,
  numeric,
}: {
  label: string;
  sortKey: string;
  controller: SortController;
  numeric?: boolean;
}) {
  return (
    <th className={numeric ? "num sortable" : "sortable"} aria-sort={controller.ariaSort(sortKey)}>
      <button type="button" onClick={() => controller.toggle(sortKey)}>
        {label}
        <span className="sort-indicator">{controller.indicator(sortKey) ?? ""}</span>
      </button>
    </th>
  );
}
