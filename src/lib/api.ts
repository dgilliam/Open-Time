// Small typed fetch client wrapping the /api contract described in docs/PLAN.md.
import { ApiError } from "./types";
import type { Project, ReportResult, TimeEntry, User } from "./types";

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

// ---------- users ----------

export function listUsers(): Promise<User[]> {
  return request<User[]>("/api/users");
}

export function createUser(input: { name: string; email: string }): Promise<User> {
  return request<User>("/api/users", { method: "POST", body: JSON.stringify(input) });
}

// ---------- projects ----------

export function listProjects(opts: { includeArchived?: boolean } = {}): Promise<Project[]> {
  const qs = opts.includeArchived ? "?includeArchived=1" : "";
  return request<Project[]>(`/api/projects${qs}`);
}

export function createProject(input: {
  name: string;
  client?: string | null;
  color?: string | null;
  hourlyRateCents?: number | null;
}): Promise<Project> {
  return request<Project>("/api/projects", { method: "POST", body: JSON.stringify(input) });
}

export function updateProject(
  id: string,
  patch: {
    name?: string;
    client?: string | null;
    color?: string;
    hourlyRateCents?: number | null;
    archived?: boolean;
  }
): Promise<Project> {
  return request<Project>(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ---------- entries ----------

export function listEntries(opts: { userId?: string; from?: string; to?: string } = {}): Promise<TimeEntry[]> {
  const params = new URLSearchParams();
  if (opts.userId) params.set("userId", opts.userId);
  if (opts.from) params.set("from", opts.from);
  if (opts.to) params.set("to", opts.to);
  const qs = params.toString();
  return request<TimeEntry[]>(`/api/entries${qs ? `?${qs}` : ""}`);
}

export function createEntry(input: {
  userId: string;
  projectId: string;
  note?: string;
  startedAt: string;
  stoppedAt: string;
}): Promise<TimeEntry> {
  return request<TimeEntry>("/api/entries", { method: "POST", body: JSON.stringify(input) });
}

export function updateEntry(
  id: string,
  patch: { note?: string; projectId?: string; startedAt?: string; stoppedAt?: string | null }
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

export function getRunningEntry(userId: string): Promise<TimeEntry | null> {
  return request<TimeEntry | null>(`/api/timer?userId=${encodeURIComponent(userId)}`);
}

export function startTimer(input: { userId: string; projectId: string; note?: string }): Promise<TimeEntry> {
  return request<TimeEntry>("/api/timer/start", { method: "POST", body: JSON.stringify(input) });
}

export function stopTimer(input: { userId: string }): Promise<TimeEntry> {
  return request<TimeEntry>("/api/timer/stop", { method: "POST", body: JSON.stringify(input) });
}

// ---------- reports ----------

export function getReport(opts: {
  from: string;
  to: string;
  groupBy: "project" | "user";
}): Promise<ReportResult> {
  const params = new URLSearchParams({ from: opts.from, to: opts.to, groupBy: opts.groupBy });
  return request<ReportResult>(`/api/reports?${params.toString()}`);
}

export function reportsCsvUrl(opts: { from: string; to: string }): string {
  const params = new URLSearchParams({ from: opts.from, to: opts.to });
  return `/api/reports/csv?${params.toString()}`;
}

export { ApiError };
