// Small typed fetch client wrapping the /api contract described in docs/PLAN.md.
import { ApiError } from "./types";
import type { CalendarDay, ReportResult, Task, TimeEntry, User } from "./types";

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

export function listUsers(): Promise<User[]> {
  return request<User[]>("/api/users");
}

export function createUser(input: { name: string; email: string; password: string }): Promise<User> {
  return request<User>("/api/users", { method: "POST", body: JSON.stringify(input) });
}

// ---------- tasks ----------

export function listTasks(q = ""): Promise<Task[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const qs = params.toString();
  return request<Task[]>(`/api/tasks${qs ? `?${qs}` : ""}`);
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

export { ApiError };
