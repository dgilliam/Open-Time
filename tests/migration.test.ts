// Verifies the v2.6 additive migration (tasks.link/details/status, see
// src/lib/db.ts) actually upgrades an existing pre-v2.6 database file rather
// than only working on a fresh CREATE TABLE. We hand-build a sqlite file
// with the pre-v2.6 tasks schema (no link/details/status columns) plus a
// pre-existing row, then import src/lib/db.ts against that file path — same
// pattern the other test files use for a fresh temp DB, since vitest gives
// each test file its own module registry.
import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDbPath = path.join(os.tmpdir(), `opentime-migration-test-${process.pid}-${Date.now()}.db`);

// Build the pre-v2.6 schema by hand (mirrors src/lib/db.ts's tables minus the
// v2.6 tasks columns) and seed one pre-existing task row, all before db.ts
// (and its migrations) ever sees this file.
const seed = new Database(tmpDbPath);
seed.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','member')),
    created_at TEXT NOT NULL,
    project TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE time_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    started_at TEXT NOT NULL,
    stopped_at TEXT,
    duration_secs INTEGER,
    created_at TEXT NOT NULL
  );
`);
seed
  .prepare("INSERT INTO tasks (id, name, created_at) VALUES (?, ?, ?)")
  .run("pre-v26-task", "AB1-legacy-task", "2026-01-01T00:00:00.000Z");
seed.close();

process.env.OPENTIME_DB = tmpDbPath;

// Imported only now so db.ts's startup migrations run against the
// hand-built pre-v2.6 file above.
const { db } = await import("../src/lib/db");

afterAll(() => {
  db.close();
  for (const f of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe("v2.6 additive migration on an existing database", () => {
  it("adds the link, details, and status columns to the tasks table", () => {
    const columns = (db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[]).map(
      (c) => c.name
    );
    expect(columns).toEqual(expect.arrayContaining(["link", "details", "status"]));
  });

  it("backfills status to 'open' for rows that predate the migration", () => {
    const row = db
      .prepare("SELECT link, details, status FROM tasks WHERE id = ?")
      .get("pre-v26-task") as { link: string | null; details: string | null; status: string };
    expect(row.status).toBe("open");
    expect(row.link).toBeNull();
    expect(row.details).toBeNull();
  });

  it("still allows normal task operations through repo.ts after migrating", async () => {
    const repo = await import("../src/lib/repo");
    const task = repo.getTaskById("pre-v26-task")!;
    expect(task.status).toBe("open");

    const admin = repo.createUser({
      name: "Drew",
      email: "drew-migration@gilli.am",
      password: "opentime-dev",
      role: "admin",
    });
    const updated = repo.updateTask(
      "pre-v26-task",
      { id: admin.id, role: "admin" },
      { status: "accepted", link: "https://reposcout.slack.com/archives/C1/p1" }
    );
    expect(updated.status).toBe("accepted");
    expect(updated.link).toBe("https://reposcout.slack.com/archives/C1/p1");
  });
});
