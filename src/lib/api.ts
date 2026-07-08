// Small typed fetch client wrapping the /api contract described in docs/PLAN.md.
import { ApiError } from "./types";
import type {
  CalendarDay,
  CurrentUninvoiced,
  InvoicePeriod,
  InvoicePeriodDetail,
  InvoicePeriodSummary,
  ReportResult,
  Task,
  TimeEntry,
  User,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "network error — is the server running?");
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // ignore, handled below
  }

  if (!res.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : `request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }

  return (json as { data: T }).data;
}

// ---------- setup ----------

export function getSetupStatus(): Promise<{ needed: boolean }> {
  return request<{ needed: boolean }>("/api/setup");
}

export function setup(input: { name: string; email: string; password: string }): Promise<User> {
  return request<User>("/api/setup", { method: "POST", body: JSON.stringify(input) });
}

// ---------- auth ----------

export function login(input: { email: string; password: string }): Promise<User> {
  return request<User>("/api/auth/login", { method: "POST", body: JSON.stringify(input) });
}

export function logout(): Promise<null> {
  return request<null>("/api/auth/logout", { method: "POST" });
}

export function me(): Promise<User | null> {
  return request<User | null>("/api/auth/me");
}

// ---------- users ----------

/** `includeRemoved` surfaces soft-removed members too (flagged via `deletedAt`) — see the Team page's "Show removed" toggle. */
export function listUsers(opts: { includeRemoved?: boolean } = {}): Promise<User[]> {
  const qs = opts.includeRemoved ? "?includeRemoved=1" : "";
  return request<User[]>(`/api/users${qs}`);
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  project?: string | null;
}): Promise<User> {
  return request<User>("/api/users", { method: "POST", body: JSON.stringify(input) });
}

export function updateUser(id: string, patch: { name?: string; project?: string | null }): Promise<User> {
  return request<User>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Soft-removes a member (admin only, v2.7). Their history is untouched; login/sessions stop resolving immediately. */
export function removeUser(id: string): Promise<User> {
  return request<User>(`/api/users/${id}`, { method: "DELETE" });
}

/** Restores a previously removed member (admin only, v2.7). */
export function restoreUser(id: string): Promise<User> {
  return request<User>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ restore: true }) });
}

// ---------- tasks ----------

export function listTasks(q = ""): Promise<Task[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const qs = params.toString();
  return request<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
}

/** Task wrap-up metadata (v2.6): link/details/status. Server enforces auth (admin or a contributor). */
export function updateTask(
  id: string,
  patch: { link?: string | null; details?: string | null; status?: string }
): Promise<Task> {
  return request<Task>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

// ---------- entries ----------

/** `userId: "all"` is admin-only (403 for members) and returns every user's entries — see the admin dashboard. */
export function listEntries(opts: { userId?: string; from?: string; to?: string } = {}): Promise<TimeEntry[]> {
  const params = new URLSearchParams();
  if (opts.userId) params.set("userId", opts.userId);
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const qs = params.toString();
  return request<TimeEntry[]>(`/api/entries${qs ? `?${qs}` : ""}`);
}

export function createEntry(input: { task: string; startedAt: string; stoppedAt: string }): Promise<TimeEntry> {
  return request<TimeEntry>("/api/entries", { method: "POST", body: JSON.stringify(input) });
}

export function updateEntry(
  id: string,
  patch: { task?: string; startedAt?: string; stoppedAt?: string | null }
): Promise<TimeEntry> {
  return request<TimeEntry>(`/api/entries/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteEntry(id: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/entries/${id}`, { method: "DELETE" });
}

// ---------- timer ----------

export function getRunningEntry(): Promise<TimeEntry | null> {
  return request<TimeEntry | null>("/api/timer");
}

export function startTimer(input: { task: string }): Promise<TimeEntry> {
  return request<TimeEntry>("/api/timer/start", { method: "POST", body: JSON.stringify(input) });
}

export function stopTimer(): Promise<TimeEntry> {
  return request<TimeEntry>("/api/timer/stop", { method: "POST" });
}

// ---------- calendar ----------

export function getCalendar(opts: { userId?: string; from: string; to: string }): Promise<CalendarDay[]> {
  const params = new URLSearchParams({ from: opts.from, to: opts.to });
  if (opts.userId) params.set("userId", opts.userId);
  return request<CalendarDay[]>(`/api/calendar?${params.toString()}`);
}

// ---------- reports ----------

/**
 * `groupBy: "task"` with `userId: "all"` is admin-only and aggregates every
 * user's hours per task, with each group's `contributors` populated — see
 * the admin dashboard.
 */
export function getReport(opts: {
  userId?: string;
  from: string;
  to: string;
  groupBy: "task" | "user";
}): Promise<ReportResult> {
  const params = new URLSearchParams({ from: opts.from, to: opts.to, groupBy: opts.groupBy });
  if (opts.userId) params.set("userId", opts.userId);
  return request<ReportResult>(`/api/reports?${params.toString()}`);
}

/**
 * Builds the /api/reports/csv URL. No fetch — the "Export CSV" link uses
 * this directly as its href so the session cookie rides along with the
 * browser-initiated download.
 */
export function reportsCsvUrl(opts: {
  userId?: string;
  from: string;
  to: string;
  project?: string;
}): string {
  const params = new URLSearchParams({ from: opts.from, to: opts.to });
  if (opts.userId) params.set("userId", opts.userId);
  // Caller passes the "__none__" sentinel directly for "No project" — see
  // the dashboard's Entries export.
  if (opts.project) params.set("project", opts.project);
  return `/api/reports/csv?${params.toString()}`;
}

// ---------- timesheet ----------

export function setTimesheetCell(input: { task: string; date: string; hours: number }): Promise<{ hours: number }> {
  return request<{ hours: number }>("/api/timesheet/cell", { method: "PUT", body: JSON.stringify(input) });
}

// ---------- invoices (v2.8, admin only) ----------

export function listInvoices(): Promise<{
  periods: InvoicePeriodSummary[];
  current: CurrentUninvoiced;
  lastBackup: string | null; // YYYY-MM-DD of the newest on-disk snapshot
}> {
  return request<{
    periods: InvoicePeriodSummary[];
    current: CurrentUninvoiced;
    lastBackup: string | null;
  }>("/api/invoices");
}

export function getInvoicePeriod(id: string): Promise<InvoicePeriodDetail> {
  return request<InvoicePeriodDetail>(`/api/invoices/${id}`);
}

export function setInvoicePeriodLocked(id: string, locked: boolean): Promise<InvoicePeriod> {
  return request<InvoicePeriod>(`/api/invoices/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ locked }),
  });
}

/** Builds the /api/invoices/[id]/csv URL — used directly as an <a href> so the session cookie rides along. */
export function invoiceCsvUrl(id: string): string {
  return `/api/invoices/${id}/csv`;
}

export { ApiError };
