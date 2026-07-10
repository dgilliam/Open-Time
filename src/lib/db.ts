import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "opentime.db");

// `next build` imports this module from several parallel page-data-collection
// workers purely as a side effect — every page is a client shell and every
// API route is force-dynamic, so the build never reads real data. Those
// workers racing the schema DDL (and, once the build outgrew the schedulers'
// 30s/60s fuses below, an invoice sweep mid-DDL) is what broke the Railway
// deploy with SQLITE_BUSY. Builds therefore get an isolated in-memory DB and
// no schedulers; only the real runtime touches the database file.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
const dbPath = isBuildPhase ? ":memory:" : process.env.OPENTIME_DB || DEFAULT_DB_PATH;

if (!isBuildPhase) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------- v1 -> v2 destructive dev migration ----------
// v2 replaces the v1 schema (users/projects/time_entries, no auth) with a new
// one (users w/ auth, sessions, tasks, time_entries w/ duration_secs). There
// is no production data to preserve yet, so on startup we just detect the
// old schema (presence of the v1-only `projects` table) and drop everything
// so the v2 tables below get created fresh. Dev-only; revisit before any
// real migration is needed.
const hasV1Schema = db
  .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'`)
  .get();

if (hasV1Schema) {
  db.exec(`
    DROP TABLE IF EXISTS time_entries;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS users;
  `);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  link TEXT,
  details TEXT,
  -- 'draft' added v2.9 section A: existing DBs got the status column via an
  -- ALTER (see v2.6), which SQLite can't attach a CHECK to, so no migration
  -- is needed here -- the enum is enforced in the repo layer (TASK_STATUSES).
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','draft','submitted','accepted','dead_end'))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  duration_secs INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_periods (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  cutoff_at TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_started_at ON time_entries(started_at);
`);

// ---------- v2.5 additive dev migration: users.project ----------
// Minimal member-level project label (docs/PLAN.md v2.5). Dev-grade
// idempotent migration: CREATE TABLE IF NOT EXISTS above won't add a column
// to an existing table, so we check PRAGMA table_info(users) for a `project`
// column and ALTER TABLE to add it if missing. No production data to
// preserve yet; revisit with a real migration tool before that changes.
// Adds a column if missing. The PRAGMA check alone races when parallel
// build workers open the same file with separate module registries (each
// passes the check before either commits its ALTER), so a losing worker's
// "duplicate column name" is swallowed — the column exists, which is all
// we need. Any other error still throws.
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (err) {
    if (!(err instanceof Error && /duplicate column name/i.test(err.message))) throw err;
  }
}

addColumnIfMissing("users", "project", "project TEXT");

// ---------- v2.6 additive dev migration: tasks.link/details/status ----------
// Task wrap-up metadata (docs/PLAN.md v2.6 section B): an optional link URL,
// optional free-text details, and a status enum defaulting to 'open'. Same
// idempotent PRAGMA-guarded ALTER pattern as v2.5's users.project above.
// Note: SQLite's ALTER TABLE ADD COLUMN cannot attach a CHECK constraint, so
// for any pre-v2.6 database migrated via the ALTERs below, the status enum
// is enforced in the repo layer instead (see updateTask in src/lib/repo.ts).
// The CREATE TABLE above already includes the CHECK for brand-new databases.
addColumnIfMissing("tasks", "link", "link TEXT");
addColumnIfMissing("tasks", "details", "details TEXT");
addColumnIfMissing("tasks", "status", "status TEXT NOT NULL DEFAULT 'open'");

// ---------- v2.7 additive dev migration: users.deleted_at (soft-delete) ----------
// "Remove member" is a soft delete (docs/PLAN.md v2.7): history must never be
// rewritten by offboarding, so removed members keep their row (and all
// joins) but are excluded from listUsers/login/session lookups by default.
// Same idempotent PRAGMA-guarded ALTER pattern as v2.5/v2.6 above.
addColumnIfMissing("users", "deleted_at", "deleted_at TEXT");

// ---------- v2.8 additive dev migration: time_entries.invoice_period_id ----------
// Invoice periods (docs/PLAN.md v2.8): each completed entry gets swept into
// a weekly invoice_periods row once its cutoff passes. SQLite allows
// REFERENCES on an ALTER TABLE ADD COLUMN (unlike inline CHECK constraints,
// which v2.6 found it can't retrofit), so this one line both adds the column
// on pre-v2.8 databases and gives it the same FK the fresh CREATE TABLE
// would have. Must run after the invoice_periods CREATE TABLE above so the
// referenced table already exists.
addColumnIfMissing(
  "time_entries",
  "invoice_period_id",
  "invoice_period_id TEXT REFERENCES invoice_periods(id)"
);
db.exec("CREATE INDEX IF NOT EXISTS idx_time_entries_invoice_period ON time_entries(invoice_period_id);");

// ---------- nightly backup schedule (production only) ----------
// This lives here, not in instrumentation.ts: Next's dev compiler bundles
// instrumentation for contexts where native modules can't resolve (it broke
// `next dev` with "Can't resolve 'fs'" via better-sqlite3). db.ts is only
// ever imported by Node-runtime code (routes, scripts, tests), so scheduling
// from here is bundler-safe. The globalThis flag guards against duplicate
// timers when separate route bundles each instantiate this module in one
// process; the dynamic import breaks the db<->backup module cycle at load
// time.
const BACKUP_FLAG = "__opentimeBackupScheduled";
if (
  !isBuildPhase &&
  process.env.NODE_ENV === "production" &&
  process.env.OPENTIME_BACKUPS !== "0" &&
  !(globalThis as Record<string, unknown>)[BACKUP_FLAG]
) {
  (globalThis as Record<string, unknown>)[BACKUP_FLAG] = true;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const runScheduled = () => {
    import("./backup")
      .then(({ runBackup }) => runBackup())
      .catch((err) => console.error("[backup] scheduled backup failed:", err));
  };
  const timer = setTimeout(() => {
    runScheduled();
    setInterval(runScheduled, ONE_DAY_MS).unref?.();
  }, 60_000);
  timer.unref?.();
  console.log("[backup] scheduled nightly backups (first run in ~60s, then every 24h)");
}

// ---------- invoice period sweep schedule (production only) ----------
// Same shape as the backup schedule above: createMissingPeriods() is
// deterministic by timestamp (docs/PLAN.md v2.8), so running it on boot and
// hourly means a missed run just self-heals up to 59 minutes late — never
// wrong, never double (see src/lib/invoices.ts). The dynamic import of
// ./invoices breaks the db<->invoices module cycle at load time, identical
// to how ./backup is loaded above.
const INVOICES_FLAG = "__opentimeInvoicesScheduled";
if (
  !isBuildPhase &&
  process.env.NODE_ENV === "production" &&
  process.env.OPENTIME_INVOICES !== "0" &&
  !(globalThis as Record<string, unknown>)[INVOICES_FLAG]
) {
  (globalThis as Record<string, unknown>)[INVOICES_FLAG] = true;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const runInvoiceSweep = () => {
    import("./invoices")
      .then(({ createMissingPeriods }) => createMissingPeriods())
      .catch((err) => console.error("[invoices] scheduled sweep failed:", err));
  };
  const invoiceTimer = setTimeout(() => {
    runInvoiceSweep();
    setInterval(runInvoiceSweep, ONE_HOUR_MS).unref?.();
  }, 30_000);
  invoiceTimer.unref?.();
  console.log("[invoices] scheduled invoice period sweep (first run in ~30s, then hourly)");
}

export default db;
