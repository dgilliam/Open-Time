import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const tmpDbPath = path.join(os.tmpdir(), `opentime-backup-test-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;

// Imported after OPENTIME_DB is set so db.ts opens the temp file.
const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const { runBackup } = await import("../src/lib/backup");

const tmpDirs: string[] = [];
function makeTmpDir(label: string): string {
  const dir = path.join(os.tmpdir(), `opentime-backup-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpDirs.push(dir);
  return dir;
}

function resetDb() {
  db.exec("DELETE FROM time_entries; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;");
}

beforeEach(() => {
  resetDb();
});

afterAll(() => {
  db.close();
  for (const f of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  for (const dir of tmpDirs) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runBackup", () => {
  it("creates a readable SQLite snapshot with the current data", async () => {
    repo.createUser({ name: "Drew", email: "drew@gilli.am", password: "opentime-dev", role: "admin" });
    repo.createUser({ name: "Alice", email: "alice@example.com", password: "password123", role: "member" });
    repo.createUser({ name: "Bob", email: "bob@example.com", password: "password123", role: "member" });

    const dir = makeTmpDir("snapshot");
    const result = await runBackup({ dir });

    expect(fs.existsSync(result.path)).toBe(true);
    expect(path.basename(result.path)).toMatch(/^opentime-\d{4}-\d{2}-\d{2}\.db$/);

    const snapshot = new Database(result.path, { readonly: true });
    const { count } = snapshot.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
    expect(count).toBe(3);
    snapshot.close();
  });

  it("overwrites the same-day snapshot file on a second run", async () => {
    const dir = makeTmpDir("overwrite");
    repo.createUser({ name: "Drew", email: "drew@gilli.am", password: "opentime-dev", role: "admin" });

    const first = await runBackup({ dir });
    repo.createUser({ name: "Alice", email: "alice@example.com", password: "password123", role: "member" });
    const second = await runBackup({ dir });

    expect(second.path).toBe(first.path);
    const files = fs.readdirSync(dir).filter((f) => /^opentime-\d{4}-\d{2}-\d{2}\.db$/.test(f));
    expect(files).toEqual([path.basename(first.path)]);

    const snapshot = new Database(second.path, { readonly: true });
    const { count } = snapshot.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
    expect(count).toBe(2);
    snapshot.close();
  });

  it("prunes older snapshots, keeping only the N newest matching files", async () => {
    const dir = makeTmpDir("prune");
    fs.mkdirSync(dir, { recursive: true });

    // Fabricate older same-pattern snapshot files via differing dates in
    // the filename (the prune logic sorts on the filename's date, not
    // mtime), plus one non-matching file that must be left alone.
    const oldNames = [
      "opentime-2020-01-01.db",
      "opentime-2020-01-02.db",
      "opentime-2020-01-03.db",
      "opentime-2020-01-04.db",
    ];
    for (const name of oldNames) {
      fs.writeFileSync(path.join(dir, name), "fake-snapshot");
    }
    fs.writeFileSync(path.join(dir, "not-a-backup.txt"), "ignore me");

    repo.createUser({ name: "Drew", email: "drew@gilli.am", password: "opentime-dev", role: "admin" });
    const result = await runBackup({ dir, keep: 2 });

    // 4 fake + 1 real (today) = 5 matching files before prune; keep=2 means
    // 3 pruned, leaving today's real snapshot plus the newest fake one.
    expect(result.pruned.length).toBe(3);
    expect(result.pruned).toEqual(
      expect.arrayContaining(["opentime-2020-01-01.db", "opentime-2020-01-02.db", "opentime-2020-01-03.db"])
    );

    const remaining = fs.readdirSync(dir).filter((f) => /^opentime-\d{4}-\d{2}-\d{2}\.db$/.test(f));
    expect(remaining.length).toBe(2);
    expect(remaining).toContain(path.basename(result.path));
    expect(remaining).toContain("opentime-2020-01-04.db");
    expect(fs.existsSync(path.join(dir, "not-a-backup.txt"))).toBe(true);
  });

  it("defaults the backup directory from OPENTIME_BACKUP_DIR", async () => {
    const dir = makeTmpDir("env-dir");
    const prevEnv = process.env.OPENTIME_BACKUP_DIR;
    process.env.OPENTIME_BACKUP_DIR = dir;
    try {
      repo.createUser({ name: "Drew", email: "drew@gilli.am", password: "opentime-dev", role: "admin" });
      const result = await runBackup();
      expect(result.path.startsWith(dir)).toBe(true);
      expect(fs.existsSync(result.path)).toBe(true);
    } finally {
      if (prevEnv === undefined) delete process.env.OPENTIME_BACKUP_DIR;
      else process.env.OPENTIME_BACKUP_DIR = prevEnv;
    }
  });
});
