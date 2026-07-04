export type Role = "admin" | "member";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface Task {
  id: string;
  name: string;
  createdAt: string;
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
}

export interface ReportResult {
  groups: ReportGroup[];
  totalHours: number;
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
