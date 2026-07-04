import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;

// Imported after OPENTIME_DB is set so db.ts opens the temp file.
const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const { ApiError } = await import("../src/lib/types");

function resetDb() {
  db.exec("DELETE FROM time_entries; DELETE FROM projects; DELETE FROM users;");
}

let userA: ReturnType<typeof repo.createUser>;
let userB: ReturnType<typeof repo.createUser>;
let projectA: ReturnType<typeof repo.createProject>;
let projectB: ReturnType<typeof repo.createProject>;

beforeEach(() => {
  resetDb();
  userA = repo.createUser({ name: "Alice", email: "alice@example.com" });
  userB = repo.createUser({ name: "Bob", email: "bob@example.com" });
  projectA = repo.createProject({
    name: "Project A",
    color: "#111111",
    hourlyRateCents: 10000,
  });
  projectB = repo.createProject({ name: "Project B", color: "#222222" });
});

afterAll(() => {
  db.close();
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  const wal = `${tmpDbPath}-wal`;
  const shm = `${tmpDbPath}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
});

describe("users", () => {
  it("creates and lists users", () => {
    const users = repo.listUsers();
    expect(users.map((u) => u.name).sort()).toEqual(["Alice", "Bob"]);
  });

  it("rejects duplicate email", () => {
    expect(() => repo.createUser({ name: "Alice 2", email: "alice@example.com" })).toThrow(
      ApiError
    );
  });

  it("rejects missing name", () => {
    expect(() => repo.createUser({ name: "", email: "x@example.com" })).toThrow(ApiError);
  });
});

describe("projects", () => {
  it("lists only active projects by default", () => {
    repo.updateProject(projectB.id, { archived: true });
    const active = repo.listProjects();
    expect(active.map((p) => p.id)).toEqual([projectA.id]);

    const all = repo.listProjects({ includeArchived: true });
    expect(all.length).toBe(2);
  });

  it("assigns a default color when none given", () => {
    const p = repo.createProject({ name: "No color" });
    expect(p.color).toBeTruthy();
  });
});

describe("createEntry validation", () => {
  it("creates a valid manual entry", () => {
    const entry = repo.createEntry({
      userId: userA.id,
      projectId: projectA.id,
      note: "did stuff",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    expect(entry.projectName).toBe("Project A");
    expect(entry.userName).toBe("Alice");
    expect(entry.projectColor).toBe("#111111");
  });

  it("rejects stoppedAt <= startedAt", () => {
    expect(() =>
      repo.createEntry({
        userId: userA.id,
        projectId: projectA.id,
        startedAt: "2026-01-01T10:00:00.000Z",
        stoppedAt: "2026-01-01T09:00:00.000Z",
      })
    ).toThrow(ApiError);
  });

  it("404s for unknown user", () => {
    try {
      repo.createEntry({
        userId: "nope",
        projectId: projectA.id,
        startedAt: "2026-01-01T09:00:00.000Z",
        stoppedAt: "2026-01-01T10:00:00.000Z",
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(404);
    }
  });

  it("404s for unknown project", () => {
    try {
      repo.createEntry({
        userId: userA.id,
        projectId: "nope",
        startedAt: "2026-01-01T09:00:00.000Z",
        stoppedAt: "2026-01-01T10:00:00.000Z",
      });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(404);
    }
  });
});

describe("timer", () => {
  it("starts a timer with no running entry", () => {
    const entry = repo.startTimer({ userId: userA.id, projectId: projectA.id, note: "start" });
    expect(entry.stoppedAt).toBeNull();
    expect(repo.getRunningEntry(userA.id)?.id).toBe(entry.id);
  });

  it("auto-stops the previous running entry when starting a new one", () => {
    const first = repo.startTimer({ userId: userA.id, projectId: projectA.id });
    const second = repo.startTimer({ userId: userA.id, projectId: projectB.id });

    const firstEntry = repo.getEntry(first.id)!;
    expect(firstEntry.stoppedAt).not.toBeNull();

    const running = repo.getRunningEntry(userA.id);
    expect(running?.id).toBe(second.id);
  });

  it("does not affect another user's running timer", () => {
    const aRunning = repo.startTimer({ userId: userA.id, projectId: projectA.id });
    repo.startTimer({ userId: userB.id, projectId: projectB.id });

    expect(repo.getRunningEntry(userA.id)?.id).toBe(aRunning.id);
  });

  it("stops a running timer", () => {
    repo.startTimer({ userId: userA.id, projectId: projectA.id });
    const stopped = repo.stopTimer({ userId: userA.id });
    expect(stopped.stoppedAt).not.toBeNull();
    expect(repo.getRunningEntry(userA.id)).toBeNull();
  });

  it("409s when stopping with nothing running", () => {
    try {
      repo.stopTimer({ userId: userA.id });
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as InstanceType<typeof ApiError>).status).toBe(409);
    }
  });
});

describe("entries listing with date filters", () => {
  beforeEach(() => {
    repo.createEntry({
      userId: userA.id,
      projectId: projectA.id,
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      projectId: projectA.id,
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userB.id,
      projectId: projectB.id,
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T11:00:00.000Z",
    });
  });

  it("filters by userId", () => {
    const entries = repo.listEntries({ userId: userA.id });
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.userId === userA.id)).toBe(true);
  });

  it("filters by from/to date range", () => {
    const entries = repo.listEntries({ from: "2026-01-03T00:00:00.000Z" });
    expect(entries.length).toBe(2);

    const entriesUpTo = repo.listEntries({ to: "2026-01-02T00:00:00.000Z" });
    expect(entriesUpTo.length).toBe(1);
  });

  it("orders newest first", () => {
    const entries = repo.listEntries({});
    expect(entries[0].startedAt >= entries[entries.length - 1].startedAt).toBe(true);
  });
});

describe("report", () => {
  beforeEach(() => {
    // 1 hour on project A (rate 10000c/hr) for userA
    repo.createEntry({
      userId: userA.id,
      projectId: projectA.id,
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    // 2 hours on project B (no rate) for userB
    repo.createEntry({
      userId: userB.id,
      projectId: projectB.id,
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T11:00:00.000Z",
    });
    // a still-running entry should be excluded from totals
    repo.startTimer({ userId: userA.id, projectId: projectA.id });
  });

  it("groups by project with correct seconds and billableCents", () => {
    const result = repo.report({ groupBy: "project" });
    expect(result.totalSeconds).toBe(3 * 3600);

    const projA = result.groups.find((g) => g.id === projectA.id)!;
    expect(projA.seconds).toBe(3600);
    expect(projA.billableCents).toBe(10000);

    const projB = result.groups.find((g) => g.id === projectB.id)!;
    expect(projB.seconds).toBe(7200);
    expect(projB.billableCents).toBeNull();
  });

  it("groups by user with correct seconds and billableCents", () => {
    const result = repo.report({ groupBy: "user" });

    const a = result.groups.find((g) => g.id === userA.id)!;
    expect(a.seconds).toBe(3600);
    expect(a.billableCents).toBe(10000);

    const b = result.groups.find((g) => g.id === userB.id)!;
    expect(b.seconds).toBe(7200);
    expect(b.billableCents).toBeNull();
  });

  it("respects from/to filters", () => {
    const result = repo.report({ from: "2026-01-02T00:00:00.000Z", groupBy: "project" });
    expect(result.totalSeconds).toBe(0);
    expect(result.groups.length).toBe(0);
  });
});

describe("entriesForCsv", () => {
  it("returns entries ordered oldest first", () => {
    repo.createEntry({
      userId: userA.id,
      projectId: projectA.id,
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      projectId: projectA.id,
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });

    const rows = repo.entriesForCsv({});
    expect(rows[0].startedAt <= rows[rows.length - 1].startedAt).toBe(true);
  });
});
