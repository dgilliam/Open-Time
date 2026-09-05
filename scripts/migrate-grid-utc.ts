// Re-anchors timesheet-grid entries from "09:00 in the submitter's zone" to
// noon UTC on the same submitter-local date (docs/PLAN.md v3.12 follow-up).
//
// Why: a 09:00 IST submission is stored at 03:30Z, right on the UTC day
// boundary, so it reads as the previous day for anyone in the Americas and
// falls in/out of "This month" depending on who exports. Noon UTC is the
// same calendar date in every zone from UTC-12 to UTC+11. Duration is never
// touched; only the anchor instant moves.
//
// DRY RUN BY DEFAULT. Prints a before/after table and changes nothing.
//
//   npx tsx scripts/migrate-grid-utc.ts --csv export.csv          # preview from "Export all (raw)"
//   npx tsx scripts/migrate-grid-utc.ts --db /data/opentime.db     # preview from a database file
//   npx tsx scripts/migrate-grid-utc.ts --db ... --apply           # write, in one transaction
//
// Options:
//   --since 2026-09-01   only rows whose started_at is on/after this UTC date (default 2026-09-01)
//   --user  "Name"       restrict to one member
//
// Scope guards, always enforced:
//   * only rows with NO invoice period (never a billed row, never a live one)
//   * only rows on/after --since
//   * only rows that look like grid submissions (see classify)
//   * --apply refuses if the DB has any candidate inside a locked period

import fs from "node:fs";

// ---------- args ----------
const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const CSV = opt("--csv");
const DB = opt("--db");
const APPLY = args.includes("--apply");
const SINCE = `${opt("--since") ?? "2026-09-01"}T00:00:00.000Z`;
const ONLY_USER = opt("--user");
if (!CSV && !DB) {
  console.error("usage: --csv <export.csv> | --db <opentime.db> [--apply] [--since YYYY-MM-DD] [--user Name]");
  process.exit(2);
}
if (APPLY && !DB) {
  console.error("--apply needs --db (a CSV can only be previewed)");
  process.exit(2);
}

// ---------- row model ----------
interface Row {
  id: string;
  member: string;
  task: string;
  startedAt: string;
  stoppedAt: string;
  durationSecs: number;
  invoicePeriod: string; // "" = uninvoiced
  invoiceLocked: boolean;
}

// ---------- load ----------
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadCsv(path: string): Row[] {
  const [header, ...lines] = parseCsv(fs.readFileSync(path, "utf8"));
  const col = (n: string) => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`CSV is missing column "${n}" — use Export all (raw) from v3.12+`);
    return i;
  };
  const c = {
    member: col("member"), task: col("task"), hours: col("duration_hours"),
    id: col("entry_id"), start: col("started_at_utc"), stop: col("stopped_at_utc"),
    period: col("invoice_period"), locked: col("invoice_locked"),
  };
  return lines.filter((l) => l.length >= header.length).map((l) => ({
    id: l[c.id], member: l[c.member], task: l[c.task],
    startedAt: l[c.start], stoppedAt: l[c.stop],
    durationSecs: Math.round(Number(l[c.hours]) * 3600),
    invoicePeriod: l[c.period], invoiceLocked: l[c.locked] === "true",
  }));
}

async function loadDb(path: string) {
  process.env.OPENTIME_DB = path;
  const { db } = await import("../src/lib/db");
  const rows = db.prepare(`
    SELECT e.id, u.name AS member, t.name AS task, e.started_at, e.stopped_at, e.duration_secs,
           COALESCE(p.label, '') AS period, COALESCE(p.locked, 0) AS locked
    FROM time_entries e
    JOIN users u ON u.id = e.user_id
    JOIN tasks t ON t.id = e.task_id
    LEFT JOIN invoice_periods p ON p.id = e.invoice_period_id
    WHERE e.stopped_at IS NOT NULL`).all() as {
      id: string; member: string; task: string; started_at: string; stopped_at: string;
      duration_secs: number; period: string; locked: number;
    }[];
  return {
    db,
    rows: rows.map((r): Row => ({
      id: r.id, member: r.member, task: r.task, startedAt: r.started_at, stoppedAt: r.stopped_at,
      durationSecs: r.duration_secs, invoicePeriod: r.period, invoiceLocked: !!r.locked,
    })),
  };
}

// ---------- classify + plan ----------
const dateIn = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/**
 * A grid submission is stored at exactly 09:00 submitter-local, so its UTC
 * time-of-day implies the submitter's offset: offset = 09:00 - utcTimeOfDay.
 * Accept it as a grid row when (a) stop - start equals duration_secs exactly
 * (timers never do, their raw span is unrounded), (b) seconds are :00, and
 * (c) the implied offset is a real one — a multiple of 15 min in [-12h, +14h].
 * Returns the implied offset in minutes, or null when it isn't a grid row.
 */
function impliedOffsetMin(r: Row): number | null {
  const start = new Date(r.startedAt), stop = new Date(r.stoppedAt);
  if ((stop.getTime() - start.getTime()) / 1000 !== r.durationSecs) return null;
  if (start.getUTCSeconds() !== 0 || start.getUTCMilliseconds() !== 0) return null;
  const utcMin = start.getUTCHours() * 60 + start.getUTCMinutes();
  let off = 9 * 60 - utcMin;
  if (off > 14 * 60) off -= 24 * 60;
  if (off < -12 * 60) off += 24 * 60;
  if (off % 15 !== 0 || off < -12 * 60 || off > 14 * 60) return null;
  return off;
}
const fmtOff = (m: number) => `${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

interface Plan { row: Row; offsetMin: number; localDate: string; newStart: string; newStop: string }

/**
 * Per-member zone check (added after the first production preview). A
 * round start time on a MANUAL entry also yields a "plausible" 09:00 offset,
 * and one member's manual rows scattered across nine implied zones. Real grid
 * rows all share the submitter's actual offset, so a row only qualifies when
 * its implied offset is the member's modal one and that mode has >= 2 rows.
 * Moving a manual row would re-date a real timestamp, which is worse than
 * leaving it.
 */
function modalOffsets(rows: Row[]): Map<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const off = impliedOffsetMin(r);
    if (off === null) continue;
    const m = counts.get(r.member) ?? new Map<number, number>();
    m.set(off, (m.get(off) ?? 0) + 1);
    counts.set(r.member, m);
  }
  // The mode must be a clear MAJORITY of the member's round-time rows, not
  // merely the most frequent value. A member who never uses the grid still
  // has a "most common" implied offset among their manual entries (one
  // production member: 2 of 11 rows at +03:30 — a zone nobody here lives
  // in). Real grid users cluster: 4 of 5, 2 of 3.
  const modal = new Map<string, number>();
  for (const [member, m] of counts) {
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    const [off, n] = Array.from(m).sort((a, b) => b[1] - a[1])[0];
    if (n >= 2 && n * 2 > total) modal.set(member, off);
  }
  return modal;
}

function plan(r: Row, expectedOffset: number | undefined): Plan | null {
  const off = impliedOffsetMin(r);
  if (off === null) return null;
  if (expectedOffset === undefined || off !== expectedOffset) return null;
  const local = new Date(new Date(r.startedAt).getTime() + off * 60_000);
  const localDate = local.toISOString().slice(0, 10);
  const newStart = `${localDate}T12:00:00.000Z`;
  if (newStart === r.startedAt) return null; // already migrated
  const newStop = new Date(new Date(newStart).getTime() + r.durationSecs * 1000).toISOString();
  return { row: r, offsetMin: off, localDate, newStart, newStop };
}

// ---------- main ----------
async function main() {
const IST = "Asia/Kolkata", CT = "America/Chicago";
let rows: Row[];
let db: import("better-sqlite3").Database | null = null;
if (CSV) rows = loadCsv(CSV);
else { const r = await loadDb(DB!); rows = r.rows; db = r.db; }
if (ONLY_USER) rows = rows.filter((r) => r.member === ONLY_USER);

const uninvoiced = rows.filter((r) => !r.invoicePeriod);
const inScope = uninvoiced.filter((r) => r.startedAt >= SINCE);
const leftAlone = uninvoiced.filter((r) => r.startedAt < SINCE);

const modal = modalOffsets(uninvoiced);
const plans: Plan[] = [], skipped: { row: Row; why: string }[] = [];
for (const r of inScope) {
  const p = plan(r, modal.get(r.member));
  if (p) { plans.push(p); continue; }
  const off = impliedOffsetMin(r);
  let why: string;
  if (r.startedAt.endsWith("T12:00:00.000Z")) why = "already at noon UTC";
  else if (off === null) why = "timer/manual — real timestamp, left as-is";
  else if (modal.get(r.member) === undefined) why = `round time but no consistent zone for this member (implied ${fmtOff(off)}) — treated as manual`;
  else why = `round time but implied ${fmtOff(off)} ≠ member's zone ${fmtOff(modal.get(r.member)!)} — treated as manual`;
  skipped.push({ row: r, why });
}
plans.sort((a, b) => a.row.member.localeCompare(b.row.member) || a.row.startedAt.localeCompare(b.row.startedAt));

const hrs = (s: number) => (s / 3600).toString();
console.log(`source: ${CSV ?? DB}   mode: ${APPLY ? "APPLY" : "dry run"}   since: ${SINCE.slice(0, 10)}${ONLY_USER ? `   user: ${ONLY_USER}` : ""}`);
console.log(`rows: ${rows.length} total · ${uninvoiced.length} uninvoiced · ${inScope.length} on/after since · ${plans.length} will move · ${skipped.length} in scope but skipped · ${leftAlone.length} uninvoiced but before since (untouched)\n`);

if (plans.length) {
  console.log("WILL MOVE  (hours never change; only the anchor instant)");
  console.log("member              task                          h     old started_at (UTC)      -> new started_at (UTC)      zone    date IST / CT before   -> after");
  for (const p of plans) {
    const r = p.row;
    console.log(
      `${r.member.padEnd(19)} ${r.task.slice(0, 29).padEnd(29)} ${hrs(r.durationSecs).padStart(5)} ` +
      `${r.startedAt}  -> ${p.newStart}  ${fmtOff(p.offsetMin)}  ` +
      `${dateIn(r.startedAt, IST)} / ${dateIn(r.startedAt, CT)} -> ${dateIn(p.newStart, IST)} / ${dateIn(p.newStart, CT)}`
    );
  }
  console.log();
}
if (skipped.length) {
  console.log("IN SCOPE, SKIPPED");
  for (const s of skipped) console.log(`  ${s.row.member.padEnd(19)} ${s.row.startedAt}  ${hrs(s.row.durationSecs)}h  ${s.why}`);
  console.log();
}
if (leftAlone.length) {
  const byMember = new Map<string, number>();
  for (const r of leftAlone) byMember.set(r.member, (byMember.get(r.member) ?? 0) + 1);
  console.log(`UNINVOICED BUT BEFORE ${SINCE.slice(0, 10)} — untouched by your rule: ` +
    Array.from(byMember).map(([m, n]) => `${m} ×${n}`).join(", "));
  console.log();
}

if (APPLY) {
  const locked = plans.filter((p) => p.row.invoiceLocked);
  if (locked.length) { console.error(`REFUSING: ${locked.length} candidate(s) sit in a locked period`); process.exit(1); }
  if (!plans.length) { console.log("nothing to apply"); process.exit(0); }
  const upd = db!.prepare("UPDATE time_entries SET started_at = ?, stopped_at = ? WHERE id = ? AND invoice_period_id IS NULL");
  const n = db!.transaction(() => plans.reduce((acc, p) => acc + upd.run(p.newStart, p.newStop, p.row.id).changes, 0))();
  console.log(`applied: ${n} row(s) updated`);
} else if (plans.length) {
  console.log(`dry run — nothing written. Re-run with --db <file> --apply to write these ${plans.length} row(s).`);
}
}

main().catch((err) => { console.error(err); process.exit(1); });
