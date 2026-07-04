import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "opentime.db");
const dbPath = process.env.OPENTIME_DB || DEFAULT_DB_PATH;

const dir = path.dirname(dbPath);
if (dir !== ":memory:" && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
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
  created_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_started_at ON time_entries(started_at);
`);

export default db;
