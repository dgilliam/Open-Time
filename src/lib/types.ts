export type Role = "admin" | "member";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  // Optional free-text label assigned by the admin (v2.5). Not a secret —
  // present regardless of caller role, but no member-facing UI renders it.
  project: string | null;
  // Soft-delete marker (v2.7): non-null when the member has been removed by
  // an admin. Only ever populated when listUsers({includeRemoved:true}) was
  // used; the default listUsers omits removed rows entirely. See
  // docs/PLAN.md v2.7.
  deletedAt: string | null;
}

export type TaskStatus = "open" | "draft" | "submitted" | "accepted" | "dead_end";

export interface Task {
  id: string;
  name: string;
  createdAt: string;
  // v2.6 wrap-up metadata (docs/PLAN.md v2.6 section B) — all optional.
  link: string | null;
  details: string | null;
  status: TaskStatus;
}

export interface TimeEntry {
  id: string;
  userId: string;
  taskId: string;
  startedAt: string; // ISO-8601 UTC, raw (never modified by rounding)
  stoppedAt: string | null; // null = running
  durationSecs: number | null; // null while running; rounded to nearest 0.5h on save
  createdAt: string;
  // joined fields
  taskName: string;
  userName: string;
  userProject: string | null;
  // Joined from the task's current wrap-up metadata (v2.6) — used by the CSV
  // export; not surfaced in the UI's entry lists.
  taskStatus: TaskStatus;
  taskLink: string | null;
  taskDetails: string | null;
  // Joined invoice period assignment (v2.8) — null until a weekly sweep
  // claims the entry. invoiceLocked mirrors the period's `locked` flag so
  // member-facing UIs can grey/hide edit affordances without an extra call.
  invoicePeriodId: string | null;
  invoiceLocked: boolean;
  // Populated only by the timer endpoints (GET /api/timer and POST
  // /api/timer/start; v3.2.1): the user's total rounded seconds already
  // recorded against this entry's task, so the running readout can continue
  // a resumed task from its recorded total instead of restarting at 0:00:00.
  taskRecordedSecs?: number;
}

// ---------- invoice periods (v2.8) ----------

export interface InvoicePeriod {
  id: string;
  label: string; // 'YYYY-MM-DD' — the Sunday the period ends on (week-ending date)
  cutoffAt: string; // ISO-8601 UTC instant of Sun 23:59 America/Los_Angeles
  locked: boolean;
  createdAt: string;
}

export interface InvoicePeriodSummary extends InvoicePeriod {
  totalHours: number;
  memberCount: number;
}

export interface InvoiceMemberSummary {
  id: string;
  name: string;
  hours: number;
}

export interface InvoiceTaskDetailRow {
  member: string; // member name, not id — mirrors the CSV's "engineer" column
  task: string;
  hours: number;
}

export interface InvoicePeriodDetail {
  period: InvoicePeriod;
  members: InvoiceMemberSummary[];
  taskDetail: InvoiceTaskDetailRow[];
}

export interface CurrentUninvoiced {
  members: InvoiceMemberSummary[];
  totalHours: number;
  nextCutoffAt: string; // ISO-8601 UTC instant of the next sweep
}

export interface Contributor {
  id: string;
  name: string;
  hours: number;
}

export interface ReportGroup {
  id: string;
  name: string;
  hours: number;
  dates: string[]; // distinct local YYYY-MM-DD dates worked, ascending
  lastWorked: string; // most recent local date worked, YYYY-MM-DD
  // Only populated for groupBy=task&userId=all (admin dashboard's cross-team
  // task view); desc by hours. Single-user/self task groups and groupBy=user
  // groups never set this.
  contributors?: Contributor[];
  // Only populated for groupBy=user: distinct tasks that user worked in range.
  taskCount?: number;
  // Only populated for groupBy=user: the user's current project label (v2.5).
  project?: string | null;
  // Only populated for groupBy=task groups (v2.6): the task's current
  // wrap-up status/link. Defaults to "open"/null when the task has never
  // been patched. Backward compatible — absent for groupBy=user groups.
  status?: TaskStatus;
  link?: string | null;
  // Only populated for groupBy=task groups (v2.6/T20): the task's current
  // wrap-up details, so any surface can prefill the wrap-up dialog.
  details?: string | null;
}

export interface ReportResult {
  groups: ReportGroup[];
  totalHours: number;
  distinctTaskCount: number; // distinct tasks across the whole result set
}

export interface CalendarDay {
  date: string; // YYYY-MM-DD, local-date bucketed (see src/lib/repo.ts)
  hours: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/** Maps a thrown error to a JSON-serializable { status, body } pair for API routes. */
export function apiErrorResponse(err: unknown): { status: number; body: { error: string } } {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: err.message } };
  }
  console.error(err);
  return { status: 500, body: { error: "internal error" } };
}
