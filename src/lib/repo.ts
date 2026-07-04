import { randomUUID } from "node:crypto";
import { db } from "./db";
import { hashPassword } from "./auth";
import { ApiError } from "./types";
import type { CalendarDay, ReportResult, Role, Task, TimeEntry, User } from "./types";

// ---------- row mappers ----------

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
}

interface TaskRow {
  id: string;
  name: string;
  created_at: string;
}

function rowToTask(row: TaskRow): Task {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

interface EntryRow {
  id: string;
  user_id: string;
  task_id: string;
  started_at: string;
  stopped_at: string | null;
  duration_secs: number | null;
  created_at: string;
  task_name: string;
  user_name: string;
}

function rowToEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    userId: row.user_id,
    taskId: row.task_id,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    durationSecs: row.duration_secs,
    createdAt: row.created_at,
    taskName: row.task_name,
    userName: row.user_name,
  };
}

// Entries are always joined with their task + user names (see TimeEntry.userName
// doc comment) — cheap joins, and it keeps route handlers thin since they
// never need a second query just to label a list for an admin view.
const ENTRY_SELECT = `
  SELECT
    e.id as id,
    e.user_id as user_id,
    e.task_id as task_id,
    e.started_at as started_at,
    e.stopped_at as stopped_at,
    e.duration_secs as duration_secs,
    e.created_at as created_at,
    t.name as task_name,
    u.name as user_name
  FROM time_entries e
  JOIN tasks t ON t.id = e.task_id
  JOIN users u ON u.id = e.user_id
`;

// ---------- rounding ----------

/** duration_secs = max(1800, round(rawSeconds / 1800) * 1800) — nearest 0.5h, 0.5h minimum. */
export function roundDurationSecs(rawSeconds: number): number {
  return Math.max(1800, Math.round(rawSeconds / 1800) * 1800);
}

// ---------- users ----------

export function countUsers(): number {
  return (db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number }).c;
}

export function listUsers(): User[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY name ASC").all() as UserRow[];
  return rows.map(rowToUser);
}

export function getUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/** Includes the password hash — for login verification only, never returned from an API route. */
export function getUserAuthByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
    | UserRow
    | undefined;
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}): User {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const password = input.password || "";
  if (!name) throw new ApiError(400, "name is required");
  if (!email) throw new ApiError(400, "email is required");
  if (password.length < 8) throw new ApiError(400, "password must be at least 8 characters");

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) throw new ApiError(400, "email already in use");

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const passwordHash = hashPassword(password);
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name, email, passwordHash, input.role, createdAt);

  return { id, name, email, role: input.role, createdAt };
}

// ---------- tasks ----------

// slug (letters/digits), a dash, then a kebab-case description.
const TASK_NAME_RE = /^[A-Za-z0-9]+-[A-Za-z0-9][A-Za-z0-9-]*$/;

/** Trims, validates, and normalizes a task name: slug uppercased, rest lowercased. */
export function normalizeTaskName(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length < 3 || trimmed.length > 120) {
    throw new ApiError(400, "task name must be between 3 and 120 characters");
  }
  if (!TASK_NAME_RE.test(trimmed)) {
    throw new ApiError(
      400,
      "task name must look like SLUG-description (a slug, a dash, then a kebab-case description)"
    );
  }
  const dashIndex = trimmed.indexOf("-");
  const slug = trimmed.slice(0, dashIndex).toUpperCase();
  const rest = trimmed.slice(dashIndex + 1).toLowerCase();
  return `${slug}-${rest}`;
}

export function findOrCreateTask(rawName: string): Task {
  const name = normalizeTaskName(rawName);
  const existing = db.prepare("SELECT * FROM tasks WHERE name = ?").get(name) as TaskRow | undefined;
  if (existing) return rowToTask(existing);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO tasks (id, name, created_at) VALUES (?, ?, ?)").run(id, name, createdAt);
  return { id, name, createdAt };
}

/** Tasks the given user has logged time to, filtered by substring, most recently used first. */
export function listTasksForUser(userId: string, q: string, limit = 20): Task[] {
  const like = `%${(q || "").trim().toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT t.id as id, t.name as name, t.created_at as created_at
       FROM tasks t
       JOIN time_entries e ON e.task_id = t.id
       WHERE e.user_id = ? AND LOWER(t.name) LIKE ?
       GROUP BY t.id
       ORDER BY MAX(e.started_at) DESC
       LIMIT ?`
    )
    .all(userId, like, limit) as TaskRow[];
  return rows.map(rowToTask);
}

// ---------- entries ----------

export function listEntries(opts: { userId?: string; from?: string; to?: string } = {}): TimeEntry[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.userId) {
    clauses.push("e.user_id = ?");
    params.push(opts.userId);
  }
  if (opts.from) {
    clauses.push("e.started_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push("e.started_at <= ?");
    params.push(opts.to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `${ENTRY_SELECT} ${where} ORDER BY e.started_at DESC`;
  const rows = db.prepare(sql).all(...params) as EntryRow[];
  return rows.map(rowToEntry);
}

export function getEntry(id: string): TimeEntry | null {
  const row = db.prepare(`${ENTRY_SELECT} WHERE e.id = ?`).get(id) as EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

function validateRange(startedAt: string, stoppedAt: string | null): void {
  if (isNaN(new Date(startedAt).getTime())) throw new ApiError(400, "startedAt is not a valid date");
  if (stoppedAt !== null) {
    if (isNaN(new Date(stoppedAt).getTime())) throw new ApiError(400, "stoppedAt is not a valid date");
    if (new Date(stoppedAt).getTime() <= new Date(startedAt).getTime()) {
      throw new ApiError(400, "stoppedAt must be after startedAt");
    }
  }
}

export function createEntry(input: {
  userId: string;
  task: string;
  startedAt: string;
  stoppedAt: string;
}): TimeEntry {
  if (!input.userId) throw new ApiError(400, "userId is required");
  if (!input.task) throw new ApiError(400, "task is required");
  if (!input.startedAt) throw new ApiError(400, "startedAt is required");
  if (!input.stoppedAt) throw new ApiError(400, "stoppedAt is required");

  validateRange(input.startedAt, input.stoppedAt);

  const task = findOrCreateTask(input.task);
  const rawSeconds =
    (new Date(input.stoppedAt).getTime() - new Date(input.startedAt).getTime()) / 1000;
  const durationSecs = roundDurationSecs(rawSeconds);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO time_entries (id, user_id, task_id, started_at, stopped_at, duration_secs, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.userId, task.id, input.startedAt, input.stoppedAt, durationSecs, createdAt);

  return getEntry(id)!;
}

export function updateEntry(
  id: string,
  patch: { task?: string; startedAt?: string; stoppedAt?: string | null }
): TimeEntry {
  const existing = getEntry(id);
  if (!existing) throw new ApiError(404, "entry not found");

  const startedAt = patch.startedAt !== undefined ? patch.startedAt : existing.startedAt;
  const stoppedAt = patch.stoppedAt !== undefined ? patch.stoppedAt : existing.stoppedAt;
  validateRange(startedAt, stoppedAt);

  const taskId = patch.task !== undefined ? findOrCreateTask(patch.task).id : existing.taskId;
  const durationSecs = stoppedAt
    ? roundDurationSecs((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000)
    : null;

  db.prepare(
    `UPDATE time_entries SET task_id = ?, started_at = ?, stopped_at = ?, duration_secs = ? WHERE id = ?`
  ).run(taskId, startedAt, stoppedAt, durationSecs, id);

  return getEntry(id)!;
}

export function deleteEntry(id: string): void {
  const existing = getEntry(id);
  if (!existing) throw new ApiError(404, "entry not found");
  db.prepare("DELETE FROM time_entries WHERE id = ?").run(id);
}

// ---------- timer ----------

export function getRunningEntry(userId: string): TimeEntry | null {
  const row = db
    .prepare(`${ENTRY_SELECT} WHERE e.user_id = ? AND e.stopped_at IS NULL`)
    .get(userId) as EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function startTimer(input: { userId: string; task: string }): TimeEntry {
  if (!input.userId) throw new ApiError(400, "userId is required");
  if (!input.task) throw new ApiError(400, "task is required");

  const task = findOrCreateTask(input.task);
  const now = new Date().toISOString();

  const txn = db.transaction(() => {
    // At most one running entry per user: auto-stop (and round) any running one.
    const running = getRunningEntry(input.userId);
    if (running) {
      const rawSeconds = (new Date(now).getTime() - new Date(running.startedAt).getTime()) / 1000;
      const durationSecs = roundDurationSecs(rawSeconds);
      db.prepare("UPDATE time_entries SET stopped_at = ?, duration_secs = ? WHERE id = ?").run(
        now,
        durationSecs,
        running.id
      );
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO time_entries (id, user_id, task_id, started_at, stopped_at, duration_secs, created_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?)`
    ).run(id, input.userId, task.id, now, now);
    return id;
  });

  const id = txn();
  return getEntry(id)!;
}

export function stopTimer(input: { userId: string }): TimeEntry {
  if (!input.userId) throw new ApiError(400, "userId is required");
  const running = getRunningEntry(input.userId);
  if (!running) throw new ApiError(409, "no running timer for user");

  const now = new Date().toISOString();
  const rawSeconds = (new Date(now).getTime() - new Date(running.startedAt).getTime()) / 1000;
  const durationSecs = roundDurationSecs(rawSeconds);
  db.prepare("UPDATE time_entries SET stopped_at = ?, duration_secs = ? WHERE id = ?").run(
    now,
    durationSecs,
    running.id
  );
  return getEntry(running.id)!;
}

// ---------- calendar ----------

/**
 * Buckets an ISO timestamp to a "YYYY-MM-DD" local-date key. v2 has no
 * per-user timezone setting, so "local" here deliberately means the
 * timezone the Node server process runs in (its TZ env var / OS default),
 * derived via Date's local getters — not the viewing browser's timezone.
 * This is a documented simplification for a single-team internal tool, not
 * an oversight; revisit if the team ever spans timezones.
 */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function calendarBuckets(opts: { userId: string; from?: string; to?: string }): CalendarDay[] {
  const entries = listEntries({ userId: opts.userId, from: opts.from, to: opts.to }).filter(
    (e) => e.durationSecs !== null
  );

  const byDate = new Map<string, number>();
  for (const entry of entries) {
    const key = localDateKey(entry.startedAt);
    byDate.set(key, (byDate.get(key) ?? 0) + (entry.durationSecs as number));
  }

  return Array.from(byDate.entries())
    .map(([date, secs]) => ({ date, hours: secs / 3600 }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// ---------- reports ----------

export function report(opts: {
  userId?: string;
  from?: string;
  to?: string;
  groupBy: "task" | "user";
}): ReportResult {
  interface Acc {
    id: string;
    name: string;
    secs: number;
  }
  const groups = new Map<string, Acc>();
  let totalSecs = 0;

  if (opts.groupBy === "task") {
    const entries = listEntries({ userId: opts.userId, from: opts.from, to: opts.to }).filter(
      (e) => e.durationSecs !== null
    );
    for (const e of entries) {
      const secs = e.durationSecs as number;
      totalSecs += secs;
      let acc = groups.get(e.taskId);
      if (!acc) {
        acc = { id: e.taskId, name: e.taskName, secs: 0 };
        groups.set(e.taskId, acc);
      }
      acc.secs += secs;
    }
  } else {
    // groupBy === "user": admin overview across everyone in range (userId filter ignored).
    const entries = listEntries({ from: opts.from, to: opts.to }).filter((e) => e.durationSecs !== null);
    for (const e of entries) {
      const secs = e.durationSecs as number;
      totalSecs += secs;
      let acc = groups.get(e.userId);
      if (!acc) {
        acc = { id: e.userId, name: e.userName, secs: 0 };
        groups.set(e.userId, acc);
      }
      acc.secs += secs;
    }
  }

  const result = Array.from(groups.values())
    .sort((a, b) => b.secs - a.secs)
    .map((acc) => ({ id: acc.id, name: acc.name, hours: acc.secs / 3600 }));

  return { groups: result, totalHours: totalSecs / 3600 };
}
