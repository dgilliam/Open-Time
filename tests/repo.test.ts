import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;

// Imported after OPENTIME_DB is set so db.ts opens the temp file.
const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const auth = await import("../src/lib/auth");
const { ApiError } = await import("../src/lib/types");

function resetDb() {
  db.exec("DELETE FROM time_entries; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;");
}

function expectApiError(fn: () => unknown, status: number) {
  try {
    fn();
    expect.fail("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(status);
  }
}

let admin: ReturnType<typeof repo.createUser>;
let userA: ReturnType<typeof repo.createUser>;
let userB: ReturnType<typeof repo.createUser>;

beforeEach(() => {
  resetDb();
  admin = repo.createUser({ name: "Drew", email: "drew@gilli.am", password: "opentime-dev", role: "admin" });
  userA = repo.createUser({ name: "Alice", email: "alice@example.com", password: "password123", role: "member" });
  userB = repo.createUser({ name: "Bob", email: "bob@example.com", password: "password123", role: "member" });
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
  it("creates and lists users with roles", () => {
    const users = repo.listUsers();
    expect(users.map((u) => u.name).sort()).toEqual(["Alice", "Bob", "Drew"]);
    expect(users.find((u) => u.email === "drew@gilli.am")?.role).toBe("admin");
    expect(users.find((u) => u.email === "alice@example.com")?.role).toBe("member");
  });

  it("rejects duplicate email", () => {
    expectApiError(
      () => repo.createUser({ name: "Alice 2", email: "alice@example.com", password: "password123", role: "member" }),
      400
    );
  });

  it("rejects missing name", () => {
    expectApiError(
      () => repo.createUser({ name: "", email: "x@example.com", password: "password123", role: "member" }),
      400
    );
  });

  it("rejects a too-short password", () => {
    expectApiError(
      () => repo.createUser({ name: "Short Pw", email: "short@example.com", password: "abc", role: "member" }),
      400
    );
  });

  it("looks up auth records (with hash) by email, case-insensitively on create", () => {
    const found = repo.getUserAuthByEmail("ALICE@example.com");
    expect(found?.id).toBe(userA.id);
    expect(found?.passwordHash).toBeTruthy();
  });

  it("countUsers reflects the current row count", () => {
    expect(repo.countUsers()).toBe(3);
  });
});

describe("task name validation and normalization", () => {
  it("normalizes the slug to uppercase and the rest to lowercase", () => {
    expect(repo.normalizeTaskName("gm7vkndn9y3f-OTP-Resend-Onboarding")).toBe(
      "GM7VKNDN9Y3F-otp-resend-onboarding"
    );
  });

  it("trims surrounding whitespace before validating", () => {
    expect(repo.normalizeTaskName("  ab1-fix-thing  ")).toBe("AB1-fix-thing");
  });

  it("accepts a minimal valid name (slug-x)", () => {
    expect(repo.normalizeTaskName("ab-x")).toBe("AB-x");
  });

  it.each([
    ["too short", "ab"],
    ["no dash", "abcdefgh"],
    ["nothing after the dash", "abc-"],
    ["starts with a dash", "-abc-def"],
    ["spaces in the description", "abc-some thing"],
    ["empty string", ""],
    ["only a dash", "-"],
  ])("rejects %s (%j)", (_label, raw) => {
    expectApiError(() => repo.normalizeTaskName(raw), 400);
  });

  it("rejects names over 120 characters", () => {
    const raw = `ab-${"x".repeat(120)}`;
    expectApiError(() => repo.normalizeTaskName(raw), 400);
  });
});

describe("findOrCreateTask", () => {
  it("creates a new task on first use", () => {
    const task = repo.findOrCreateTask("ab12-new-feature");
    expect(task.name).toBe("AB12-new-feature");
    expect(task.id).toBeTruthy();
  });

  it("returns the same task for the same normalized name", () => {
    const first = repo.findOrCreateTask("ab12-new-feature");
    const second = repo.findOrCreateTask("AB12-NEW-FEATURE");
    expect(second.id).toBe(first.id);
  });

  it("treats differently-cased raw input as the same task once normalized", () => {
    const first = repo.findOrCreateTask("xy9-fix-bug");
    const second = repo.findOrCreateTask("XY9-fix-bug");
    expect(second.id).toBe(first.id);
    const all = db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    expect(all.c).toBe(1);
  });
});

describe("task autocomplete scoping (/api/tasks?q=)", () => {
  beforeEach(() => {
    // userA has logged time to two tasks; userB to a third. A task only B
    // has used must never show up in A's autocomplete.
    repo.createEntry({
      userId: userA.id,
      task: "ab1-alpha-task",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab2-beta-task",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userB.id,
      task: "ab3-gamma-task",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T10:00:00.000Z",
    });
  });

  it("only returns tasks the given user has logged time to", () => {
    const tasksForA = repo.listTasksForUser(userA.id, "");
    expect(tasksForA.map((t) => t.name).sort()).toEqual(["AB1-alpha-task", "AB2-beta-task"]);
  });

  it("filters by substring (case-insensitive)", () => {
    const tasksForA = repo.listTasksForUser(userA.id, "beta");
    expect(tasksForA.map((t) => t.name)).toEqual(["AB2-beta-task"]);
  });

  it("orders most recently used first", () => {
    // Re-log time against the alpha task more recently than beta.
    repo.createEntry({
      userId: userA.id,
      task: "ab1-alpha-task",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });
    const tasksForA = repo.listTasksForUser(userA.id, "");
    expect(tasksForA.map((t) => t.name)).toEqual(["AB1-alpha-task", "AB2-beta-task"]);
  });

  it("caps results at the given limit", () => {
    for (let i = 0; i < 25; i++) {
      repo.createEntry({
        userId: userA.id,
        task: `t${i}-task-number-${i}`,
        startedAt: `2026-02-${String((i % 27) + 1).padStart(2, "0")}T09:00:00.000Z`,
        stoppedAt: `2026-02-${String((i % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
      });
    }
    const tasksForA = repo.listTasksForUser(userA.id, "", 20);
    expect(tasksForA.length).toBe(20);
  });
});

describe("rounding math", () => {
  it.each([
    [60, 1800],
    [1799, 1800],
    [1800, 1800],
    [2000, 1800],
    [2699, 1800],
    [2700, 3600], // exact half rounds up (JS Math.round semantics)
    [3200, 3600],
    [3600, 3600],
    [5400, 5400],
    [5401, 5400],
  ])("rounds %i raw seconds to %i", (raw, expected) => {
    expect(repo.roundDurationSecs(raw)).toBe(expected);
  });

  it("applies the 0.5h minimum even for a near-zero duration", () => {
    expect(repo.roundDurationSecs(1)).toBe(1800);
  });
});

describe("createEntry validation and rounding", () => {
  it("creates a valid manual entry, find-or-creating the task", () => {
    const entry = repo.createEntry({
      userId: userA.id,
      task: "ab4-did-stuff",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    expect(entry.taskName).toBe("AB4-did-stuff");
    expect(entry.userName).toBe("Alice");
    expect(entry.durationSecs).toBe(3600);
    // raw timestamps preserved unmodified
    expect(entry.startedAt).toBe("2026-01-01T09:00:00.000Z");
    expect(entry.stoppedAt).toBe("2026-01-01T10:00:00.000Z");
  });

  it("rounds a sub-30-minute entry up to the 0.5h minimum", () => {
    const entry = repo.createEntry({
      userId: userA.id,
      task: "ab5-quick-fix",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T09:10:00.000Z",
    });
    expect(entry.durationSecs).toBe(1800);
    expect(entry.stoppedAt).toBe("2026-01-01T09:10:00.000Z");
  });

  it("rejects stoppedAt <= startedAt", () => {
    expectApiError(
      () =>
        repo.createEntry({
          userId: userA.id,
          task: "ab6-bad-range",
          startedAt: "2026-01-01T10:00:00.000Z",
          stoppedAt: "2026-01-01T09:00:00.000Z",
        }),
      400
    );
  });

  it("rejects an invalid task name", () => {
    expectApiError(
      () =>
        repo.createEntry({
          userId: userA.id,
          task: "not a valid task",
          startedAt: "2026-01-01T09:00:00.000Z",
          stoppedAt: "2026-01-01T10:00:00.000Z",
        }),
      400
    );
  });
});

describe("updateEntry", () => {
  it("re-rounds duration when the range changes", () => {
    const entry = repo.createEntry({
      userId: userA.id,
      task: "ab7-editable",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    expect(entry.durationSecs).toBe(3600);

    const updated = repo.updateEntry(entry.id, { stoppedAt: "2026-01-01T09:20:00.000Z" });
    expect(updated.durationSecs).toBe(1800);
    expect(updated.startedAt).toBe("2026-01-01T09:00:00.000Z");
  });

  it("re-targets the task via find-or-create", () => {
    const entry = repo.createEntry({
      userId: userA.id,
      task: "ab8-original",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    const updated = repo.updateEntry(entry.id, { task: "ab9-renamed" });
    expect(updated.taskName).toBe("AB9-renamed");
  });

  it("404s for an unknown entry", () => {
    expectApiError(() => repo.updateEntry("nope", { task: "ab1-x" }), 404);
  });
});

describe("timer", () => {
  it("starts a timer with no running entry", () => {
    const entry = repo.startTimer({ userId: userA.id, task: "ab10-start-me" });
    expect(entry.stoppedAt).toBeNull();
    expect(entry.durationSecs).toBeNull();
    expect(repo.getRunningEntry(userA.id)?.id).toBe(entry.id);
  });

  it("auto-stops and rounds the previous running entry when starting a new one", () => {
    const first = repo.startTimer({ userId: userA.id, task: "ab11-first" });
    const second = repo.startTimer({ userId: userA.id, task: "ab12-second" });

    const firstEntry = repo.getEntry(first.id)!;
    expect(firstEntry.stoppedAt).not.toBeNull();
    expect(firstEntry.durationSecs).not.toBeNull();
    expect((firstEntry.durationSecs as number) % 1800).toBe(0);

    const running = repo.getRunningEntry(userA.id);
    expect(running?.id).toBe(second.id);
  });

  it("does not affect another user's running timer", () => {
    const aRunning = repo.startTimer({ userId: userA.id, task: "ab13-a-task" });
    repo.startTimer({ userId: userB.id, task: "ab14-b-task" });

    expect(repo.getRunningEntry(userA.id)?.id).toBe(aRunning.id);
  });

  it("stops a running timer and rounds the duration", () => {
    repo.startTimer({ userId: userA.id, task: "ab15-stop-me" });
    const stopped = repo.stopTimer({ userId: userA.id });
    expect(stopped.stoppedAt).not.toBeNull();
    expect((stopped.durationSecs as number) % 1800).toBe(0);
    expect(stopped.durationSecs).toBeGreaterThanOrEqual(1800);
    expect(repo.getRunningEntry(userA.id)).toBeNull();
  });

  it("409s when stopping with nothing running", () => {
    expectApiError(() => repo.stopTimer({ userId: userA.id }), 409);
  });
});

describe("entries listing with date filters", () => {
  beforeEach(() => {
    repo.createEntry({
      userId: userA.id,
      task: "ab16-one",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab17-two",
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userB.id,
      task: "ab18-three",
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

describe("calendar bucketing", () => {
  it("groups entries by local date derived from started_at and sums hours", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab19-morning",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab20-afternoon",
      startedAt: "2026-01-01T14:00:00.000Z",
      stoppedAt: "2026-01-01T16:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab21-other-day",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T09:30:00.000Z",
    });

    const days = repo.calendarBuckets({ userId: userA.id });
    const day1 = days.find((d) => d.date === "2026-01-01");
    const day2 = days.find((d) => d.date === "2026-01-02");
    expect(day1?.hours).toBe(3); // 1h + 2h
    expect(day2?.hours).toBe(0.5);
  });

  it("excludes a currently-running entry from the bucketed totals", () => {
    repo.startTimer({ userId: userA.id, task: "ab22-running" });
    const days = repo.calendarBuckets({ userId: userA.id });
    expect(days.length).toBe(0);
  });

  it("scopes to the requested user only", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab23-a",
      startedAt: "2026-01-10T09:00:00.000Z",
      stoppedAt: "2026-01-10T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userB.id,
      task: "ab24-b",
      startedAt: "2026-01-10T09:00:00.000Z",
      stoppedAt: "2026-01-10T13:00:00.000Z",
    });
    const daysA = repo.calendarBuckets({ userId: userA.id });
    expect(daysA.find((d) => d.date === "2026-01-10")?.hours).toBe(1);
  });
});

describe("report", () => {
  beforeEach(() => {
    // 1 hour on task alpha for userA
    repo.createEntry({
      userId: userA.id,
      task: "ab25-alpha",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    // 2 hours on task beta for userB
    repo.createEntry({
      userId: userB.id,
      task: "ab26-beta",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T11:00:00.000Z",
    });
    // a still-running entry should be excluded from totals
    repo.startTimer({ userId: userA.id, task: "ab25-alpha" });
  });

  it("groups by task with correct hours, scoped to one user", () => {
    const result = repo.report({ userId: userA.id, groupBy: "task" });
    expect(result.totalHours).toBe(1);
    expect(result.groups.length).toBe(1);
    expect(result.groups[0].name).toBe("AB25-alpha");
    expect(result.groups[0].hours).toBe(1);
  });

  it("groups by user across everyone (admin overview)", () => {
    const result = repo.report({ groupBy: "user" });
    expect(result.totalHours).toBe(3);
    const a = result.groups.find((g) => g.id === userA.id)!;
    const b = result.groups.find((g) => g.id === userB.id)!;
    expect(a.hours).toBe(1);
    expect(b.hours).toBe(2);
  });

  it("respects from/to filters", () => {
    const result = repo.report({ userId: userA.id, from: "2026-01-02T00:00:00.000Z", groupBy: "task" });
    expect(result.totalHours).toBe(0);
    expect(result.groups.length).toBe(0);
  });
});

describe("auth", () => {
  it("hashes and verifies a correct password", () => {
    const hash = auth.hashPassword("correct horse battery staple");
    expect(auth.verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const hash = auth.hashPassword("correct horse battery staple");
    expect(auth.verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces a different salt (and hash string) each time", () => {
    const hash1 = auth.hashPassword("same-password");
    const hash2 = auth.hashPassword("same-password");
    expect(hash1).not.toBe(hash2);
    expect(auth.verifyPassword("same-password", hash1)).toBe(true);
    expect(auth.verifyPassword("same-password", hash2)).toBe(true);
  });

  it("resolves a valid session token to its user", () => {
    const { token } = auth.createSession(userA.id);
    const resolved = auth.getSessionUser(token);
    expect(resolved?.id).toBe(userA.id);
  });

  it("returns null for an unknown token", () => {
    expect(auth.getSessionUser("not-a-real-token")).toBeNull();
  });

  it("returns null for an expired session", () => {
    const { token } = auth.createSession(userA.id);
    // Force the session to have already expired.
    const tokenHash = createHash("sha256").update(token).digest("hex");
    db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?").run(
      "2000-01-01T00:00:00.000Z",
      tokenHash
    );
    expect(auth.getSessionUser(token)).toBeNull();
  });

  it("invalidates a session after deleteSession", () => {
    const { token } = auth.createSession(userA.id);
    expect(auth.getSessionUser(token)?.id).toBe(userA.id);
    auth.deleteSession(token);
    expect(auth.getSessionUser(token)).toBeNull();
  });

  it("requireAdmin distinguishes admin from member users", () => {
    expect(() => {
      if (userA.role !== "admin") throw new ApiError(403, "admin only");
    }).toThrow(ApiError);
    expect(admin.role).toBe("admin");
  });

  it("assertSelfOrAdmin allows self, allows admin-on-anyone, blocks member-on-other", () => {
    expect(() => auth.assertSelfOrAdmin(userA, userA.id)).not.toThrow();
    expect(() => auth.assertSelfOrAdmin(admin, userA.id)).not.toThrow();
    expectApiError(() => auth.assertSelfOrAdmin(userA, userB.id), 403);
  });
});
