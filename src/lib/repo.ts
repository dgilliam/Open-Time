import { randomUUID } from "node:crypto";
import { db } from "./db";
import { ApiError } from "./types";
import type { Project, ReportResult, TimeEntry, User } from "./types";

const DEFAULT_PROJECT_COLORS = [
  "#4f46e5",
  "#0ea5e9",
  "#16a34a",
  "#f59e0b",
  "#db2777",
  "#64748b",
];

function pickDefaultColor(): string {
  const n = (db.prepare("SELECT COUNT(*) as c FROM projects").get() as { c: number }).c;
  return DEFAULT_PROJECT_COLORS[n % DEFAULT_PROJECT_COLORS.length];
}

// ---------- row mappers ----------

interface UserRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at,
  };
}

interface ProjectRow {
  id: string;
  name: string;
  client: string | null;
  color: string;
  hourly_rate_cents: number | null;
  archived: number;
  created_at: string;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    color: row.color,
    hourlyRateCents: row.hourly_rate_cents,
    archived: !!row.archived,
    createdAt: row.created_at,
  };
}

interface EntryRow {
  id: string;
  user_id: string;
  project_id: string;
  note: string;
  started_at: string;
  stopped_at: string | null;
  created_at: string;
  project_name: string;
  project_color: string;
  user_name: string;
}

function rowToEntry(row: EntryRow): TimeEntry {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    note: row.note,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    createdAt: row.created_at,
    projectName: row.project_name,
    projectColor: row.project_color,
    userName: row.user_name,
  };
}

const ENTRY_SELECT = `
  SELECT
    e.id as id,
    e.user_id as user_id,
    e.project_id as project_id,
    e.note as note,
    e.started_at as started_at,
    e.stopped_at as stopped_at,
    e.created_at as created_at,
    p.name as project_name,
    p.color as project_color,
    u.name as user_name
  FROM time_entries e
  JOIN projects p ON p.id = e.project_id
  JOIN users u ON u.id = e.user_id
`;

// ---------- users ----------

export function listUsers(): User[] {
  const rows = db.prepare("SELECT * FROM users ORDER BY name ASC").all() as UserRow[];
  return rows.map(rowToUser);
}

export function getUser(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function createUser(input: { name: string; email: string }): User {
  const name = (input.name || "").trim();
  const email = (input.email || "").trim();
  if (!name) throw new ApiError(400, "name is required");
  if (!email) throw new ApiError(400, "email is required");

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) throw new ApiError(400, "email already in use");

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    name,
    email,
    createdAt
  );
  return { id, name, email, createdAt };
}

// ---------- projects ----------

export function listProjects(opts: { includeArchived?: boolean } = {}): Project[] {
  const sql = opts.includeArchived
    ? "SELECT * FROM projects ORDER BY name ASC"
    : "SELECT * FROM projects WHERE archived = 0 ORDER BY name ASC";
  const rows = db.prepare(sql).all() as ProjectRow[];
  return rows.map(rowToProject);
}

export function getProject(id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? rowToProject(row) : null;
}

export function createProject(input: {
  name: string;
  client?: string | null;
  color?: string | null;
  hourlyRateCents?: number | null;
}): Project {
  const name = (input.name || "").trim();
  if (!name) throw new ApiError(400, "name is required");
  if (
    input.hourlyRateCents !== undefined &&
    input.hourlyRateCents !== null &&
    (typeof input.hourlyRateCents !== "number" || input.hourlyRateCents < 0)
  ) {
    throw new ApiError(400, "hourlyRateCents must be a non-negative number");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const color = input.color && input.color.trim() ? input.color.trim() : pickDefaultColor();
  const client = input.client ?? null;
  const hourlyRateCents = input.hourlyRateCents ?? null;

  db.prepare(
    `INSERT INTO projects (id, name, client, color, hourly_rate_cents, archived, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`
  ).run(id, name, client, color, hourlyRateCents, createdAt);

  return {
    id,
    name,
    client,
    color,
    hourlyRateCents,
    archived: false,
    createdAt,
  };
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
): Project {
  const existing = getProject(id);
  if (!existing) throw new ApiError(404, "project not found");

  const name = patch.name !== undefined ? patch.name.trim() : existing.name;
  if (patch.name !== undefined && !name) throw new ApiError(400, "name cannot be empty");

  const client = patch.client !== undefined ? patch.client : existing.client;
  const color = patch.color !== undefined ? patch.color : existing.color;
  const hourlyRateCents =
    patch.hourlyRateCents !== undefined ? patch.hourlyRateCents : existing.hourlyRateCents;
  if (
    hourlyRateCents !== null &&
    hourlyRateCents !== undefined &&
    (typeof hourlyRateCents !== "number" || hourlyRateCents < 0)
  ) {
    throw new ApiError(400, "hourlyRateCents must be a non-negative number");
  }
  const archived = patch.archived !== undefined ? patch.archived : existing.archived;

  db.prepare(
    `UPDATE projects SET name = ?, client = ?, color = ?, hourly_rate_cents = ?, archived = ?
     WHERE id = ?`
  ).run(name, client, color, hourlyRateCents, archived ? 1 : 0, id);

  return {
    id,
    name,
    client,
    color,
    hourlyRateCents: hourlyRateCents ?? null,
    archived: !!archived,
    createdAt: existing.createdAt,
  };
}

// ---------- entries ----------

export function listEntries(opts: {
  userId?: string;
  from?: string;
  to?: string;
} = {}): TimeEntry[] {
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

export function createEntry(input: {
  userId: string;
  projectId: string;
  note?: string;
  startedAt: string;
  stoppedAt: string;
}): TimeEntry {
  if (!input.userId) throw new ApiError(400, "userId is required");
  if (!input.projectId) throw new ApiError(400, "projectId is required");
  if (!input.startedAt) throw new ApiError(400, "startedAt is required");
  if (!input.stoppedAt) throw new ApiError(400, "stoppedAt is required");

  const user = getUser(input.userId);
  if (!user) throw new ApiError(404, "user not found");
  const project = getProject(input.projectId);
  if (!project) throw new ApiError(404, "project not found");

  const startedAt = new Date(input.startedAt);
  const stoppedAt = new Date(input.stoppedAt);
  if (isNaN(startedAt.getTime())) throw new ApiError(400, "startedAt is not a valid date");
  if (isNaN(stoppedAt.getTime())) throw new ApiError(400, "stoppedAt is not a valid date");
  if (stoppedAt.getTime() <= startedAt.getTime()) {
    throw new ApiError(400, "stoppedAt must be after startedAt");
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const note = input.note ?? "";

  db.prepare(
    `INSERT INTO time_entries (id, user_id, project_id, note, started_at, stopped_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.userId, input.projectId, note, input.startedAt, input.stoppedAt, createdAt);

  return getEntry(id)!;
}

export function updateEntry(
  id: string,
  patch: {
    note?: string;
    projectId?: string;
    startedAt?: string;
    stoppedAt?: string | null;
  }
): TimeEntry {
  const existing = getEntry(id);
  if (!existing) throw new ApiError(404, "entry not found");

  if (patch.projectId !== undefined) {
    const project = getProject(patch.projectId);
    if (!project) throw new ApiError(404, "project not found");
  }

  const note = patch.note !== undefined ? patch.note : existing.note;
  const projectId = patch.projectId !== undefined ? patch.projectId : existing.projectId;
  const startedAt = patch.startedAt !== undefined ? patch.startedAt : existing.startedAt;
  const stoppedAt = patch.stoppedAt !== undefined ? patch.stoppedAt : existing.stoppedAt;

  if (patch.startedAt !== undefined && isNaN(new Date(patch.startedAt).getTime())) {
    throw new ApiError(400, "startedAt is not a valid date");
  }
  if (
    patch.stoppedAt !== undefined &&
    patch.stoppedAt !== null &&
    isNaN(new Date(patch.stoppedAt).getTime())
  ) {
    throw new ApiError(400, "stoppedAt is not a valid date");
  }
  if (stoppedAt) {
    if (new Date(stoppedAt).getTime() <= new Date(startedAt).getTime()) {
      throw new ApiError(400, "stoppedAt must be after startedAt");
    }
  }

  db.prepare(
    `UPDATE time_entries SET note = ?, project_id = ?, started_at = ?, stopped_at = ? WHERE id = ?`
  ).run(note, projectId, startedAt, stoppedAt, id);

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

export function startTimer(input: {
  userId: string;
  projectId: string;
  note?: string;
}): TimeEntry {
  if (!input.userId) throw new ApiError(400, "userId is required");
  if (!input.projectId) throw new ApiError(400, "projectId is required");

  const user = getUser(input.userId);
  if (!user) throw new ApiError(404, "user not found");
  const project = getProject(input.projectId);
  if (!project) throw new ApiError(404, "project not found");

  const now = new Date().toISOString();

  const txn = db.transaction(() => {
    const running = getRunningEntry(input.userId);
    if (running) {
      db.prepare("UPDATE time_entries SET stopped_at = ? WHERE id = ?").run(now, running.id);
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO time_entries (id, user_id, project_id, note, started_at, stopped_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(id, input.userId, input.projectId, input.note ?? "", now, now);
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
  db.prepare("UPDATE time_entries SET stopped_at = ? WHERE id = ?").run(now, running.id);
  return getEntry(running.id)!;
}

// ---------- reports ----------

function secondsBetween(startedAt: string, stoppedAt: string): number {
  return Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000);
}

export function report(opts: {
  from?: string;
  to?: string;
  groupBy: "project" | "user";
}): ReportResult {
  const entries = listEntries({ from: opts.from, to: opts.to }).filter(
    (e) => e.stoppedAt !== null
  );

  const rateByProjectId = new Map<string, number | null>();
  for (const p of listProjects({ includeArchived: true })) {
    rateByProjectId.set(p.id, p.hourlyRateCents);
  }

  interface Acc {
    id: string;
    name: string;
    seconds: number;
    billableCents: number | null;
    hasRate: boolean;
  }
  const groups = new Map<string, Acc>();
  let totalSeconds = 0;

  for (const entry of entries) {
    const seconds = secondsBetween(entry.startedAt, entry.stoppedAt as string);
    totalSeconds += seconds;

    const key = opts.groupBy === "project" ? entry.projectId : entry.userId;
    const name = opts.groupBy === "project" ? entry.projectName : entry.userName;

    let acc = groups.get(key);
    if (!acc) {
      acc = { id: key, name, seconds: 0, billableCents: null, hasRate: false };
      groups.set(key, acc);
    }
    acc.seconds += seconds;

    const rate = rateByProjectId.get(entry.projectId) ?? null;
    if (rate !== null) {
      acc.hasRate = true;
      const contribution = Math.round((seconds / 3600) * rate);
      acc.billableCents = (acc.billableCents ?? 0) + contribution;
    }
  }

  const result = Array.from(groups.values())
    .sort((a, b) => b.seconds - a.seconds)
    .map((acc) => ({
      id: acc.id,
      name: acc.name,
      seconds: acc.seconds,
      billableCents: acc.hasRate ? acc.billableCents : null,
    }));

  return { groups: result, totalSeconds };
}

export function entriesForCsv(opts: { from?: string; to?: string } = {}): TimeEntry[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.from) {
    clauses.push("e.started_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push("e.started_at <= ?");
    params.push(opts.to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const sql = `${ENTRY_SELECT} ${where} ORDER BY e.started_at ASC`;
  const rows = db.prepare(sql).all(...params) as EntryRow[];
  return rows.map(rowToEntry);
}
