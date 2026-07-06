// Invoice periods (docs/PLAN.md v2.8): the founder invoices Monday AM off a
// weekly Sunday-23:59-America/Los_Angeles cutoff. This module owns the
// Pacific-time cutoff math, the idempotent sweep that assigns completed
// entries to periods, and the period read/lock queries the API routes need.
//
// Dependency direction: this file imports only `db` (src/lib/db.ts) and
// `types`, never `repo.ts`. That keeps db.ts able to dynamically `import()`
// this module for its hourly scheduler (mirroring the existing backup.ts
// pattern) without a load-time cycle, while repo.ts is free to import the
// `assertEntryEditable` lock-check from here for updateEntry/deleteEntry/
// setTimesheetCell.
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { ApiError } from "./types";
import type {
  CurrentUninvoiced,
  InvoiceMemberSummary,
  InvoicePeriod,
  InvoicePeriodDetail,
  InvoicePeriodSummary,
  InvoiceTaskDetailRow,
  Role,
} from "./types";

const PACIFIC_TZ = "America/Los_Angeles";
const pad = (n: number) => String(n).padStart(2, "0");

// ---------- Pacific-time cutoff math (Intl only, no new deps) ----------

/**
 * Offset in minutes such that `localWallClock = utcInstant + offset`, for
 * the given IANA `timeZone` at the given instant. Handles DST because the
 * offset is derived from how the zone actually renders that specific
 * instant, not from a fixed UTC delta.
 */
function tzOffsetMinutesAt(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return (asUtc - instant.getTime()) / 60_000;
}

/**
 * The UTC instant of 23:59:00 America/Los_Angeles on the given Y/M/D
 * (Gregorian calendar date, no timezone attached to the inputs). Computes an
 * initial guess treating the wall-clock digits as UTC, derives the Pacific
 * offset near that guess, and re-derives it from the corrected instant once
 * more (cheap and exact even right on a DST transition, since the guess is
 * only ever off by the offset itself, well within the same local day).
 */
export function pacificCutoffUtc(year: number, month: number, day: number): Date {
  const guessMs = Date.UTC(year, month - 1, day, 23, 59, 0);
  const offset1 = tzOffsetMinutesAt(new Date(guessMs), PACIFIC_TZ);
  let utcMs = guessMs - offset1 * 60_000;
  const offset2 = tzOffsetMinutesAt(new Date(utcMs), PACIFIC_TZ);
  if (offset2 !== offset1) {
    utcMs = guessMs - offset2 * 60_000;
  }
  return new Date(utcMs);
}

/** The cutoff instant for a period labeled 'YYYY-MM-DD' (the Sunday week-ending date). */
export function cutoffForLabel(label: string): Date {
  const [y, m, d] = label.split("-").map(Number);
  return pacificCutoffUtc(y, m, d);
}

function formatLabel(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Y/M/D of `instant` as rendered in Pacific time. */
function pacificDateParts(instant: Date): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Weekday-independent shift of a Y/M/D calendar date by `days` (may be negative). */
function shiftDateParts(
  year: number,
  month: number,
  day: number,
  days: number
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/** Day-of-week (0=Sun..6=Sat) of a Y/M/D calendar date — timezone-independent, a property of the date itself. */
function dayOfWeek(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The most recent Sunday on or before the given Pacific calendar date. */
function sundayOnOrBefore(year: number, month: number, day: number) {
  return shiftDateParts(year, month, day, -dayOfWeek(year, month, day));
}

/** The next Sunday on or after the given Pacific calendar date. */
function sundayOnOrAfter(year: number, month: number, day: number) {
  const dow = dayOfWeek(year, month, day);
  return shiftDateParts(year, month, day, dow === 0 ? 0 : 7 - dow);
}

/**
 * The most recent Sunday-23:59-PT cutoff that has already passed relative to
 * `now`. Used for bootstrap: the first period ever created represents
 * "everything through last Sunday was already invoiced manually".
 */
function mostRecentPastCutoff(now: Date): { label: string; cutoffAt: Date } {
  const { year, month, day } = pacificDateParts(now);
  let sunday = sundayOnOrBefore(year, month, day);
  let cutoffAt = pacificCutoffUtc(sunday.year, sunday.month, sunday.day);
  if (cutoffAt.getTime() > now.getTime()) {
    sunday = shiftDateParts(sunday.year, sunday.month, sunday.day, -7);
    cutoffAt = pacificCutoffUtc(sunday.year, sunday.month, sunday.day);
  }
  return { label: formatLabel(sunday.year, sunday.month, sunday.day), cutoffAt };
}

/** The next Sunday-23:59-PT cutoff strictly after `now` — the live "next sweep" instant for the current-week preview. */
export function nextCutoffAfter(now: Date): Date {
  const { year, month, day } = pacificDateParts(now);
  let sunday = sundayOnOrAfter(year, month, day);
  let cutoffAt = pacificCutoffUtc(sunday.year, sunday.month, sunday.day);
  if (cutoffAt.getTime() <= now.getTime()) {
    sunday = shiftDateParts(sunday.year, sunday.month, sunday.day, 7);
    cutoffAt = pacificCutoffUtc(sunday.year, sunday.month, sunday.day);
  }
  return cutoffAt;
}

// ---------- row mapping ----------

interface PeriodRow {
  id: string;
  label: string;
  cutoff_at: string;
  locked: number;
  created_at: string;
}

function rowToPeriod(row: PeriodRow): InvoicePeriod {
  return {
    id: row.id,
    label: row.label,
    cutoffAt: row.cutoff_at,
    locked: !!row.locked,
    createdAt: row.created_at,
  };
}

function getPeriodRow(id: string): PeriodRow | undefined {
  return db.prepare("SELECT * FROM invoice_periods WHERE id = ?").get(id) as PeriodRow | undefined;
}

// ---------- sweep ----------

/**
 * Creates one invoice period for `label`/`cutoffAt` and assigns every
 * completed entry that isn't yet invoiced (`invoice_period_id IS NULL`) and
 * started before the cutoff. Transactional. The label is UNIQUE, so a
 * concurrent duplicate attempt (two processes racing the same missing week)
 * throws a SQLite "UNIQUE constraint failed" error, which is swallowed here
 * — the period already exists, which is all we need (same pattern as
 * db.ts's addColumnIfMissing).
 */
function tryCreatePeriod(label: string, cutoffAt: Date): InvoicePeriod | null {
  try {
    const txn = db.transaction((): InvoicePeriod => {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      db.prepare(
        "INSERT INTO invoice_periods (id, label, cutoff_at, locked, created_at) VALUES (?, ?, ?, 1, ?)"
      ).run(id, label, cutoffAt.toISOString(), createdAt);
      db.prepare(
        `UPDATE time_entries
         SET invoice_period_id = ?
         WHERE invoice_period_id IS NULL AND stopped_at IS NOT NULL AND started_at < ?`
      ).run(id, cutoffAt.toISOString());
      return rowToPeriod(getPeriodRow(id)!);
    });
    return txn();
  } catch (err) {
    if (err instanceof Error && /unique constraint failed/i.test(err.message)) return null;
    throw err;
  }
}

/**
 * Computes every Sunday-23:59-PT cutoff that's missing a period, up to
 * `now`, and creates them in order (oldest first) so each period's sweep
 * only picks up entries not already claimed by an earlier one. Bootstrap
 * (no periods exist yet): creates only the most recent PAST cutoff,
 * sweeping ALL prior uninvoiced completed entries in one shot. Idempotent —
 * safe to call on every boot and hourly thereafter; a second call with
 * nothing new to do creates nothing.
 */
export function createMissingPeriods(now: Date = new Date()): InvoicePeriod[] {
  const created: InvoicePeriod[] = [];
  const latest = db
    .prepare("SELECT * FROM invoice_periods ORDER BY cutoff_at DESC LIMIT 1")
    .get() as PeriodRow | undefined;

  if (!latest) {
    const { label, cutoffAt } = mostRecentPastCutoff(now);
    const period = tryCreatePeriod(label, cutoffAt);
    if (period) created.push(period);
    return created;
  }

  const [ly, lm, ld] = latest.label.split("-").map(Number);
  let sunday = { year: ly, month: lm, day: ld };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    sunday = shiftDateParts(sunday.year, sunday.month, sunday.day, 7);
    const cutoffAt = pacificCutoffUtc(sunday.year, sunday.month, sunday.day);
    if (cutoffAt.getTime() > now.getTime()) break;
    const label = formatLabel(sunday.year, sunday.month, sunday.day);
    const period = tryCreatePeriod(label, cutoffAt);
    if (period) created.push(period);
  }
  return created;
}

// ---------- locking ----------

/**
 * Throws 403 "already invoiced" when `invoicePeriodId` points at a LOCKED
 * period and the acting user isn't an admin. `actingUser` is optional so
 * internal/trusted callers (seed script, existing repo-level tests written
 * before v2.8) that don't pass one keep their prior no-lock-check behavior;
 * every route handler passes the real acting user.
 */
export function assertEntryEditable(
  invoicePeriodId: string | null,
  actingUser?: { id: string; role: Role }
): void {
  if (!invoicePeriodId) return;
  if (!actingUser || actingUser.role === "admin") return;
  const row = getPeriodRow(invoicePeriodId);
  if (row?.locked) throw new ApiError(403, "already invoiced");
}

/** Admin-only: flips a period's locked flag. Unlocking never detaches entries — no re-sweep, no double-billing. */
export function setInvoicePeriodLocked(id: string, locked: boolean): InvoicePeriod {
  const existing = getPeriodRow(id);
  if (!existing) throw new ApiError(404, "invoice period not found");
  db.prepare("UPDATE invoice_periods SET locked = ? WHERE id = ?").run(locked ? 1 : 0, id);
  return rowToPeriod(getPeriodRow(id)!);
}

// ---------- reads ----------

/** All periods, most recent first, each with totalHours/memberCount aggregated from its swept entries. */
export function listInvoicePeriods(): InvoicePeriodSummary[] {
  const rows = db.prepare("SELECT * FROM invoice_periods ORDER BY cutoff_at DESC").all() as PeriodRow[];
  return rows.map((row) => {
    const agg = db
      .prepare(
        `SELECT COALESCE(SUM(duration_secs), 0) as secs, COUNT(DISTINCT user_id) as members
         FROM time_entries WHERE invoice_period_id = ?`
      )
      .get(row.id) as { secs: number; members: number };
    return { ...rowToPeriod(row), totalHours: agg.secs / 3600, memberCount: agg.members };
  });
}

export function getInvoicePeriod(id: string): InvoicePeriod | null {
  const row = getPeriodRow(id);
  return row ? rowToPeriod(row) : null;
}

interface DetailEntryRow {
  user_id: string;
  user_name: string;
  task_name: string;
  duration_secs: number;
}

/** Per-member totals + per-member/per-task detail rows for one period. 404 for an unknown id. */
export function invoicePeriodDetail(id: string): InvoicePeriodDetail {
  const row = getPeriodRow(id);
  if (!row) throw new ApiError(404, "invoice period not found");

  const entryRows = db
    .prepare(
      `SELECT u.id as user_id, u.name as user_name, t.name as task_name, e.duration_secs as duration_secs
       FROM time_entries e
       JOIN users u ON u.id = e.user_id
       JOIN tasks t ON t.id = e.task_id
       WHERE e.invoice_period_id = ?`
    )
    .all(id) as DetailEntryRow[];

  const memberMap = new Map<string, InvoiceMemberSummary>();
  const taskMap = new Map<string, InvoiceTaskDetailRow>();
  for (const r of entryRows) {
    const hours = r.duration_secs / 3600;

    const member = memberMap.get(r.user_id) ?? { id: r.user_id, name: r.user_name, hours: 0 };
    member.hours += hours;
    memberMap.set(r.user_id, member);

    const taskKey = `${r.user_id}\x00${r.task_name}`;
    const detail = taskMap.get(taskKey) ?? { member: r.user_name, task: r.task_name, hours: 0 };
    detail.hours += hours;
    taskMap.set(taskKey, detail);
  }

  const members = Array.from(memberMap.values()).sort((a, b) => b.hours - a.hours);
  const taskDetail = Array.from(taskMap.values()).sort((a, b) => {
    if (a.member !== b.member) return a.member < b.member ? -1 : 1;
    return b.hours - a.hours;
  });

  return { period: rowToPeriod(row), members, taskDetail };
}

interface UninvoicedRow {
  user_id: string;
  user_name: string;
  secs: number;
}

/** Live preview of the next sweep: per-member totals of completed, not-yet-invoiced entries, plus the next cutoff instant. */
export function currentUninvoiced(now: Date = new Date()): CurrentUninvoiced {
  const rows = db
    .prepare(
      `SELECT u.id as user_id, u.name as user_name, COALESCE(SUM(e.duration_secs), 0) as secs
       FROM time_entries e
       JOIN users u ON u.id = e.user_id
       WHERE e.invoice_period_id IS NULL AND e.stopped_at IS NOT NULL
       GROUP BY u.id, u.name`
    )
    .all() as UninvoicedRow[];

  const members: InvoiceMemberSummary[] = rows
    .map((r) => ({ id: r.user_id, name: r.user_name, hours: r.secs / 3600 }))
    .sort((a, b) => b.hours - a.hours);
  const totalHours = members.reduce((sum, m) => sum + m.hours, 0);

  return { members, totalHours, nextCutoffAt: nextCutoffAfter(now).toISOString() };
}
