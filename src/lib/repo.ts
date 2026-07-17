import { randomUUID } from "node:crypto";
import { db } from "./db";
import { hashPassword } from "./auth";
import { assertEntryEditable } from "./invoices";
import { ApiError } from "./types";
import type {
  CalendarDay,
  ReportGroup,
  ReportResult,
  Role,
  Task,
  TaskStatus,
  TimeEntry,
  User,
} from "./types";

// ---------- row mappers ----------

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  created_at: string;
  project: string | null;
  deleted_at: string | null;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    project: row.project ?? null,
    deletedAt: row.deleted_at ?? null,
  };
}

interface TaskRow {
  id: string;
  name: string;
  created_at: string;
  link: string | null;
  details: string | null;
  status: string;
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    link: row.link ?? null,
    details: row.details ?? null,
    status: (row.status ?? "open") as TaskStatus,
  };
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
  task_status: string;
  task_link: string | null;
  task_details: string | null;
  user_name: string;
  user_project: string | null;
  invoice_period_id: string | null;
  invoice_period_locked: number | null;
  task_recorded_secs: number;
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
    userProject: row.user_project ?? null,
    taskStatus: (row.task_status ?? "open") as TaskStatus,
    taskLink: row.task_link ?? null,
    taskDetails: row.task_details ?? null,
    invoicePeriodId: row.invoice_period_id ?? null,
    invoiceLocked: !!row.invoice_period_locked,
    taskRecordedSecs: row.task_recorded_secs,
  };
}

// Entries are always joined with their task + user names (see TimeEntry.userName
// doc comment) — cheap joins, and it keeps route handlers thin since they
// never need a second query just to label a list for an admin view. The
// invoice_periods LEFT JOIN (v2.8) surfaces invoicePeriodId/invoiceLocked so
// member-facing UIs can grey/hide edit affordances without an extra call.
// task_recorded_secs (v3.2.1) is the entry owner's rounded all-time total on
// the entry's task — the timer readout, week cards, and timesheet rows all
// show a resumed task's running total from it.
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
    t.status as task_status,
    t.link as task_link,
    t.details as task_details,
    u.name as user_name,
    u.project as user_project,
    e.invoice_period_id as invoice_period_id,
    p.locked as invoice_period_locked,
    (SELECT COALESCE(SUM(d.duration_secs), 0)
       FROM time_entries d
      WHERE d.user_id = e.user_id AND d.task_id = e.task_id AND d.stopped_at IS NOT NULL
    ) as task_recorded_secs
  FROM time_entries e
  JOIN tasks t ON t.id = e.task_id
  JOIN users u ON u.id = e.user_id
  LEFT JOIN invoice_periods p ON p.id = e.invoice_period_id
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

/**
 * Lists users, name ASC. Removed (soft-deleted) members are excluded by
 * default — they must vanish from every picker/filter/Team stat surface
 * (docs/PLAN.md v2.7). Pass includeRemoved for the admin Team page's "Show
 * removed" toggle; removed rows come back with `deletedAt` set so the caller
 * can flag/grey them.
 */
export function listUsers(opts: { includeRemoved?: boolean } = {}): User[] {
  const sql = opts.includeRemoved
    ? "SELECT * FROM users ORDER BY name ASC"
    : "SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name ASC";
  const rows = db.prepare(sql).all() as UserRow[];
  return rows.map(rowToUser);
}

/** Unfiltered lookup by id (used internally by admin mutations, which must be able to find a removed user too). */
export function getUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/**
 * Includes the password hash — for login verification only, never returned
 * from an API route. Excludes removed members: a soft-deleted member's login
 * is blocked immediately (docs/PLAN.md v2.7).
 */
export function getUserAuthByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ? AND deleted_at IS NULL")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

/**
 * Trims a raw project label; "" (or whitespace-only) normalizes to NULL
 * (unassigned); over 60 chars is a 400. See docs/PLAN.md v2.5.
 */
export function normalizeProject(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 60) throw new ApiError(400, "project must be at most 60 characters");
  return trimmed;
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
  project?: string | null;
}): User {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const password = input.password || "";
  if (!name) throw new ApiError(400, "name is required");
  if (!email) throw new ApiError(400, "email is required");
  if (password.length < 8) throw new ApiError(400, "password must be at least 8 characters");
  const project = normalizeProject(input.project);

  // Email uniqueness is global — including removed members, since their row
  // still exists (soft delete). Point the admin at restore rather than
  // letting them create a colliding duplicate (docs/PLAN.md v2.7).
  const existing = db.prepare("SELECT id, deleted_at FROM users WHERE email = ?").get(email) as
    | { id: string; deleted_at: string | null }
    | undefined;
  if (existing) {
    if (existing.deleted_at) {
      throw new ApiError(400, "email belongs to a removed member — restore them instead");
    }
    throw new ApiError(400, "email already in use");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const passwordHash = hashPassword(password);
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, role, created_at, project) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, name, email, passwordHash, input.role, createdAt, project);

  return { id, name, email, role: input.role, createdAt, project, deletedAt: null };
}

/**
 * Admin-only patch of a member's name, project, and/or password (v3.4).
 * 404 if the user doesn't exist. A password reset (same ≥8-char rule as
 * createUser) also deletes the target's sessions in the same transaction —
 * whoever held the old password is signed out immediately, mirroring
 * removeUser — except when the admin is resetting their own password
 * (`actingUserId === id`), which would pointlessly log them out mid-request.
 */
export function updateUser(
  id: string,
  patch: { name?: string; project?: string | null; password?: string },
  actingUserId?: string
): User {
  const existing = getUserById(id);
  if (!existing) throw new ApiError(404, "user not found");

  let name = existing.name;
  if (patch.name !== undefined) {
    name = patch.name.trim();
    if (!name) throw new ApiError(400, "name is required");
  }
  const project = patch.project !== undefined ? normalizeProject(patch.project) : existing.project;

  let passwordHash: string | null = null;
  if (patch.password !== undefined) {
    if (patch.password.length < 8) throw new ApiError(400, "password must be at least 8 characters");
    passwordHash = hashPassword(patch.password);
  }

  const txn = db.transaction(() => {
    db.prepare("UPDATE users SET name = ?, project = ? WHERE id = ?").run(name, project, id);
    if (passwordHash !== null) {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
      if (id !== actingUserId) {
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      }
    }
  });
  txn();
  return getUserById(id)!;
}

/**
 * Soft-removes a member (docs/PLAN.md v2.7): sets deleted_at and deletes
 * their sessions in the same transaction, so any live session stops
 * resolving immediately. 404 for an unknown user, 400 when the acting admin
 * targets themselves (an admin can't remove their own account). History
 * (entries/reports/CSV) is untouched — joins don't filter on deleted_at.
 */
export function removeUser(id: string, actingUserId: string): User {
  const existing = getUserById(id);
  if (!existing) throw new ApiError(404, "user not found");
  if (id === actingUserId) throw new ApiError(400, "cannot remove yourself");

  const deletedAt = new Date().toISOString();
  const txn = db.transaction(() => {
    db.prepare("UPDATE users SET deleted_at = ? WHERE id = ?").run(deletedAt, id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  });
  txn();
  return getUserById(id)!;
}

/** Clears deleted_at, bringing a removed member back. 404 for an unknown user. */
export function restoreUser(id: string): User {
  const existing = getUserById(id);
  if (!existing) throw new ApiError(404, "user not found");

  db.prepare("UPDATE users SET deleted_at = NULL WHERE id = ?").run(id);
  return getUserById(id)!;
}

// ---------- tasks ----------

// slug (letters/digits), a dash, then a kebab-case description.
const TASK_NAME_RE = /^[A-Za-z0-9]+-[A-Za-z0-9][A-Za-z0-9-]*$/;

/**
 * Trims, collapses internal whitespace runs to a single space, and validates
 * length (2-120 chars). If the result matches the slug format it's
 * normalized as before (slug uppercased, rest lowercased); otherwise it's
 * accepted verbatim as free text (casing preserved). See "Task name rules
 * (relaxed 2026-07-05)" in docs/PLAN.md.
 */
export function normalizeTaskName(raw: string): string {
  const cleaned = (raw ?? "").trim().replace(/\s+/g, " ");
  if (cleaned.length < 2 || cleaned.length > 120) {
    throw new ApiError(400, "task name must be 2-120 characters");
  }
  if (TASK_NAME_RE.test(cleaned)) {
    const dashIndex = cleaned.indexOf("-");
    const slug = cleaned.slice(0, dashIndex).toUpperCase();
    const rest = cleaned.slice(dashIndex + 1).toLowerCase();
    return `${slug}-${rest}`;
  }
  return cleaned;
}

// Task identity is case-insensitive: lookups match WHERE LOWER(name) =
// LOWER(?) so e.g. "Internal Meeting" and "internal meeting" resolve to the
// same task (first-seen casing wins). The tasks.name UNIQUE constraint is
// still a plain (case-sensitive) unique index; callers must always go
// through findOrCreateTask rather than inserting directly.
export function findOrCreateTask(rawName: string): Task {
  const name = normalizeTaskName(rawName);
  const existing = db.prepare("SELECT * FROM tasks WHERE LOWER(name) = LOWER(?)").get(name) as
    | TaskRow
    | undefined;
  if (existing) return rowToTask(existing);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO tasks (id, name, created_at) VALUES (?, ?, ?)").run(id, name, createdAt);
  return { id, name, createdAt, link: null, details: null, status: "open" };
}

export function getTaskById(id: string): Task | null {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
  return row ? rowToTask(row) : null;
}

export const TASK_STATUSES: TaskStatus[] = ["open", "draft", "submitted", "accepted", "dead_end"];

/** True when `value` parses as an http/https URL. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Patches a task's wrap-up metadata (link/details/status) — docs/PLAN.md
 * v2.6 section B. Authorization lives here (not the route): allowed for an
 * admin, or a member who has logged at least one time entry on this task;
 * 403 otherwise. 404 for an unknown task id. Validation: status must be one
 * of TASK_STATUSES (400) — SQLite's ALTER-added status column has no CHECK
 * constraint on pre-v2.6 databases, so this is the actual enforcement point;
 * link trims to null, and when non-empty must parse as an http(s) URL
 * (400) and be ≤500 chars; details trims to null and must be ≤2000 chars.
 */
export function updateTask(
  taskId: string,
  actingUser: { id: string; role: Role },
  patch: { link?: string | null; details?: string | null; status?: string }
): Task {
  const existing = getTaskById(taskId);
  if (!existing) throw new ApiError(404, "task not found");

  if (actingUser.role !== "admin") {
    const hasEntry = db
      .prepare("SELECT 1 FROM time_entries WHERE task_id = ? AND user_id = ? LIMIT 1")
      .get(taskId, actingUser.id);
    if (!hasEntry) throw new ApiError(403, "forbidden");
  }

  let status = existing.status;
  if (patch.status !== undefined) {
    if (!TASK_STATUSES.includes(patch.status as TaskStatus)) {
      throw new ApiError(400, "status must be one of open, draft, submitted, accepted, dead_end");
    }
    status = patch.status as TaskStatus;
  }

  let link = existing.link;
  if (patch.link !== undefined) {
    const trimmed = (patch.link ?? "").trim();
    if (!trimmed) {
      link = null;
    } else {
      if (trimmed.length > 500) throw new ApiError(400, "link must be at most 500 characters");
      if (!isHttpUrl(trimmed)) throw new ApiError(400, "link must be a valid http(s) URL");
      link = trimmed;
    }
  }

  let details = existing.details;
  if (patch.details !== undefined) {
    const trimmed = (patch.details ?? "").trim();
    if (trimmed.length > 2000) throw new ApiError(400, "details must be at most 2000 characters");
    details = trimmed ? trimmed : null;
  }

  db.prepare("UPDATE tasks SET link = ?, details = ?, status = ? WHERE id = ?").run(
    link,
    details,
    status,
    taskId
  );
  return getTaskById(taskId)!;
}

/** Tasks the given user has logged time to, filtered by substring, most recently used first. */
export function listTasksForUser(userId: string, q: string, limit = 20): Task[] {
  const like = `%${(q || "").trim().toLowerCase()}%`;
  const rows = db
    .prepare(
      `SELECT t.id as id, t.name as name, t.created_at as created_at,
              t.link as link, t.details as details, t.status as status
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

export function listEntries(
  opts: { userId?: string; from?: string; to?: string; project?: string | null } = {}
): TimeEntry[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  // "all" is the admin-dashboard sentinel for "every user" (admin-gated by the
  // route via assertSelfOrAdmin before this is ever reached) — same as
  // omitting userId entirely.
  if (opts.userId && opts.userId !== "all") {
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
  // project: undefined = off; the JS value null = unassigned members only
  // (u.project IS NULL); a string = exact, case-sensitive match on the
  // member's CURRENT project label (see docs/PLAN.md v2.4 addendum).
  if (opts.project === null) {
    clauses.push("u.project IS NULL");
  } else if (opts.project !== undefined) {
    clauses.push("u.project = ?");
    params.push(opts.project);
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
  patch: { task?: string; startedAt?: string; stoppedAt?: string | null },
  actingUser?: { id: string; role: Role }
): TimeEntry {
  const existing = getEntry(id);
  if (!existing) throw new ApiError(404, "entry not found");
  assertEntryEditable(existing.invoicePeriodId, actingUser);

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

export function deleteEntry(id: string, actingUser?: { id: string; role: Role }): void {
  const existing = getEntry(id);
  if (!existing) throw new ApiError(404, "entry not found");
  assertEntryEditable(existing.invoicePeriodId, actingUser);
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
      // Same task already running: idempotent no-op (v3.2.1). Client-side
      // guards can't be trusted here — a second tab or a stale `running`
      // state would otherwise turn every "start again" press into a
      // stop+start pair, minting a min-rounded 0.5h duplicate entry each
      // time. Splitting one task into separate sessions stays possible via
      // an explicit Stop first.
      if (running.taskId === task.id) return running.id;
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
export function localDateKey(iso: string): string {
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
  userId?: string; // "all" = cross-team aggregation (admin-gated by the route); groupBy=task only
  from?: string;
  to?: string;
  groupBy: "task" | "user";
}): ReportResult {
  interface Acc {
    id: string;
    name: string;
    secs: number;
    dates: Set<string>;
    contributors?: Map<string, { name: string; secs: number }>;
    taskIds?: Set<string>;
    project?: string | null;
    status?: TaskStatus;
    link?: string | null;
    details?: string | null;
  }
  const groups = new Map<string, Acc>();
  let totalSecs = 0;
  const allTaskIds = new Set<string>();

  // Only the admin dashboard's cross-team task grouping (groupBy=task,
  // userId=all) tracks per-contributor breakdowns; single-user/self task
  // groups and groupBy=user groups leave `contributors` unset.
  const withContributors = opts.groupBy === "task" && opts.userId === "all";

  function addToGroup(
    key: string,
    name: string,
    secs: number,
    dateKey: string,
    contributor?: { id: string; name: string },
    taskId?: string,
    project?: string | null,
    taskStatus?: TaskStatus,
    taskLink?: string | null,
    taskDetails?: string | null
  ): void {
    totalSecs += secs;
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        id: key,
        name,
        secs: 0,
        dates: new Set(),
        contributors: withContributors ? new Map() : undefined,
        project,
        status: taskStatus,
        link: taskLink,
        details: taskDetails,
      };
      groups.set(key, acc);
    }
    acc.secs += secs;
    acc.dates.add(dateKey);
    if (taskId) {
      allTaskIds.add(taskId);
      (acc.taskIds ??= new Set()).add(taskId);
    }
    if (withContributors && contributor) {
      const existing = acc.contributors!.get(contributor.id);
      if (existing) {
        existing.secs += secs;
      } else {
        acc.contributors!.set(contributor.id, { name: contributor.name, secs });
      }
    }
  }

  if (opts.groupBy === "task") {
    const entries = listEntries({ userId: opts.userId, from: opts.from, to: opts.to }).filter(
      (e) => e.durationSecs !== null
    );
    for (const e of entries) {
      addToGroup(
        e.taskId,
        e.taskName,
        e.durationSecs as number,
        localDateKey(e.startedAt),
        { id: e.userId, name: e.userName },
        e.taskId,
        undefined,
        e.taskStatus,
        e.taskLink,
        e.taskDetails
      );
    }
  } else {
    // groupBy === "user": admin overview across everyone in range (userId filter ignored).
    const entries = listEntries({ from: opts.from, to: opts.to }).filter((e) => e.durationSecs !== null);
    for (const e of entries) {
      addToGroup(
        e.userId,
        e.userName,
        e.durationSecs as number,
        localDateKey(e.startedAt),
        undefined,
        e.taskId,
        e.userProject
      );
    }
  }

  // All groupings sort by most recent activity desc (ties broken by hours desc).
  const result = Array.from(groups.values())
    .map((acc) => {
      const dates = Array.from(acc.dates).sort();
      const group: ReportGroup = {
        id: acc.id,
        name: acc.name,
        hours: acc.secs / 3600,
        dates,
        lastWorked: dates[dates.length - 1],
      };
      if (withContributors) {
        group.contributors = Array.from(acc.contributors!.entries())
          .map(([id, c]) => ({ id, name: c.name, hours: c.secs / 3600 }))
          .sort((a, b) => b.hours - a.hours);
      }
      if (opts.groupBy === "user") {
        group.taskCount = acc.taskIds?.size ?? 0;
        group.project = acc.project ?? null;
      }
      if (opts.groupBy === "task") {
        group.status = acc.status ?? "open";
        group.link = acc.link ?? null;
        group.details = acc.details ?? null;
      }
      return group;
    })
    .sort((a, b) => {
      if (a.lastWorked !== b.lastWorked) return a.lastWorked < b.lastWorked ? 1 : -1;
      return b.hours - a.hours;
    });

  return { groups: result, totalHours: totalSecs / 3600, distinctTaskCount: allTaskIds.size };
}

// ---------- timesheet ----------

const TIMESHEET_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Replaces a single user's COMPLETED entries for one task+local-date with (at
 * most) one synthetic entry starting at 09:00 local that day. Running entries
 * are never selected by this query (stopped_at IS NOT NULL), so they're
 * untouched and never counted. hours <= 0 deletes without inserting.
 */
export function setTimesheetCell(input: {
  userId: string;
  task: string;
  date: string;
  hours: number;
  actingUser?: { id: string; role: Role };
}): { hours: number } {
  if (!input.userId) throw new ApiError(400, "userId is required");
  if (typeof input.hours !== "number" || !Number.isFinite(input.hours)) {
    throw new ApiError(400, "hours must be a number");
  }
  if (input.hours < 0 || input.hours > 24) {
    throw new ApiError(400, "hours must be between 0 and 24");
  }
  if (!TIMESHEET_DATE_RE.test(input.date || "")) {
    throw new ApiError(400, "date must be in YYYY-MM-DD format");
  }

  // Validates + normalizes the task name (throws 400 on bad format) without
  // creating a task just to immediately clear a cell that never had one.
  const taskName = normalizeTaskName(input.task);

  const txn = db.transaction((): { hours: number } => {
    const existingTaskRow = db.prepare("SELECT id FROM tasks WHERE LOWER(name) = LOWER(?)").get(taskName) as
      | { id: string }
      | undefined;

    if (existingTaskRow) {
      const rows = db
        .prepare(
          `SELECT id, started_at, invoice_period_id FROM time_entries
           WHERE user_id = ? AND task_id = ? AND stopped_at IS NOT NULL`
        )
        .all(input.userId, existingTaskRow.id) as {
        id: string;
        started_at: string;
        invoice_period_id: string | null;
      }[];
      const matching = rows.filter((row) => localDateKey(row.started_at) === input.date);
      // Check every affected entry for a locked invoice period BEFORE deleting
      // any of them — a 403 must leave the cell untouched, not partially
      // cleared (docs/PLAN.md v2.8 locking).
      for (const row of matching) {
        assertEntryEditable(row.invoice_period_id, input.actingUser);
      }
      for (const row of matching) {
        db.prepare("DELETE FROM time_entries WHERE id = ?").run(row.id);
      }
    }

    if (input.hours <= 0) return { hours: 0 };

    const task = existingTaskRow ?? findOrCreateTask(input.task);
    const durationSecs = roundDurationSecs(input.hours * 3600);
    const [y, m, d] = input.date.split("-").map(Number);
    const startedAt = new Date(y, m - 1, d, 9, 0, 0, 0);
    const stoppedAt = new Date(startedAt.getTime() + durationSecs * 1000);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO time_entries (id, user_id, task_id, started_at, stopped_at, duration_secs, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.userId, task.id, startedAt.toISOString(), stoppedAt.toISOString(), durationSecs, createdAt);

    return { hours: durationSecs / 3600 };
  });

  return txn();
}
