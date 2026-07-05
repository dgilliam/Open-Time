"use client";

// Small shared client-side sort helper for the admin dashboard's three
// tables (Team, Tasks, Entries). Not wired to any API — purely reorders
// already-fetched rows. See docs/PLAN.md v2.2 click-to-sort addendum:
// text columns default asc on first click, numeric/date columns default
// desc; second click flips; subsequent clicks keep toggling (no
// "unsorted" state once a column has been clicked).

import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";

export interface SortableColumn<T> {
  /** Value used for comparison; strings compare via localeCompare, numbers numerically. */
  accessor: (row: T) => string | number;
  /** Direction applied the first time this column is clicked. */
  defaultDir: SortDir;
}

export type AriaSort = "ascending" | "descending" | undefined;

export interface SortController {
  /** Click handler for a column's header button. */
  toggle: (key: string) => void;
  /** Value for the th's aria-sort attribute; undefined when this column isn't active. */
  ariaSort: (key: string) => AriaSort;
  /** ▲/▼ when this column is active, otherwise null (render as empty to reserve space). */
  indicator: (key: string) => "▲" | "▼" | null;
  /** Key of the currently active sort column, or null if the user hasn't clicked yet. */
  activeKey: string | null;
}

export interface UseSortableResult<T> extends SortController {
  /** Rows in sort order: untouched (caller's default order) until a column is clicked. */
  sorted: T[];
}

/**
 * rows: already-filtered rows in the caller's default order (used verbatim
 *   until the user clicks a header).
 * columns: sort key -> accessor/defaultDir for every clickable header.
 * tiebreak: stable secondary comparator applied when the primary accessor
 *   values are equal (per plan: "stable secondary by name/task asc").
 */
export function useSortable<T>(
  rows: T[],
  columns: Record<string, SortableColumn<T>>,
  tiebreak: (a: T, b: T) => number
): UseSortableResult<T> {
  const [state, setState] = useState<{ key: string; dir: SortDir } | null>(null);

  function toggle(key: string) {
    setState((prev) => {
      if (!prev || prev.key !== key) {
        return { key, dir: columns[key].defaultDir };
      }
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  function ariaSort(key: string): AriaSort {
    if (!state || state.key !== key) return undefined;
    return state.dir === "asc" ? "ascending" : "descending";
  }

  function indicator(key: string): "▲" | "▼" | null {
    if (!state || state.key !== key) return null;
    return state.dir === "asc" ? "▲" : "▼";
  }

  const sorted = useMemo(() => {
    if (!state) return rows;
    const col = columns[state.key];
    if (!col) return rows;
    const mult = state.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.accessor(a);
      const bv = col.accessor(b);
      const cmp =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return cmp !== 0 ? cmp * mult : tiebreak(a, b);
    });
    // columns/tiebreak are stable per caller render (defined inline with
    // useMemo below in the page); rows is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, state]);

  return { sorted, toggle, ariaSort, indicator, activeKey: state?.key ?? null };
}
