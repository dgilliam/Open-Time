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

  it("creates a user with an optional project", () => {
    const withProject = repo.createUser({
      name: "Charlie",
      email: "charlie@example.com",
      password: "password123",
      role: "member",
      project: "AI Assessor",
    });
    expect(withProject.project).toBe("AI Assessor");
  });

  it("defaults project to null when omitted", () => {
    expect(userA.project).toBeNull();
  });
});

describe("normalizeProject", () => {
  it("returns null for undefined/null/empty/whitespace-only input", () => {
    expect(repo.normalizeProject(undefined)).toBeNull();
    expect(repo.normalizeProject(null)).toBeNull();
    expect(repo.normalizeProject("")).toBeNull();
    expect(repo.normalizeProject("   ")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(repo.normalizeProject("  Platform  ")).toBe("Platform");
  });

  it("accepts exactly 60 characters", () => {
    const raw = "x".repeat(60);
    expect(repo.normalizeProject(raw)).toBe(raw);
  });

  it("rejects a project over 60 characters", () => {
    expectApiError(() => repo.normalizeProject("x".repeat(61)), 400);
  });
});

describe("updateUser", () => {
  it("sets a project on a user", () => {
    const updated = repo.updateUser(userA.id, { project: "Platform" });
    expect(updated.project).toBe("Platform");
  });

  it("clears a project by setting an empty string", () => {
    repo.updateUser(userA.id, { project: "Platform" });
    const cleared = repo.updateUser(userA.id, { project: "" });
    expect(cleared.project).toBeNull();
  });

  it("updates the name when provided", () => {
    const updated = repo.updateUser(userA.id, { name: "Alicia" });
    expect(updated.name).toBe("Alicia");
  });

  it("rejects an empty name", () => {
    expectApiError(() => repo.updateUser(userA.id, { name: "  " }), 400);
  });

  it("leaves name/project untouched when omitted from the patch", () => {
    repo.updateUser(userA.id, { project: "Platform" });
    const updated = repo.updateUser(userA.id, {});
    expect(updated.name).toBe("Alice");
    expect(updated.project).toBe("Platform");
  });

  it("404s for an unknown user", () => {
    expectApiError(() => repo.updateUser("nope", { project: "Platform" }), 404);
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
    ["empty string", ""],
    ["whitespace only", "   "],
    ["only a dash (1 char)", "-"],
    ["a single character", "a"],
  ])("rejects %s (%j)", (_label, raw) => {
    expectApiError(() => repo.normalizeTaskName(raw), 400);
  });

  it("rejects names over 120 characters", () => {
    const raw = `ab-${"x".repeat(120)}`;
    expectApiError(() => repo.normalizeTaskName(raw), 400);
  });

  it("accepts free text that doesn't match the slug format, preserving casing", () => {
    expect(repo.normalizeTaskName("Internal Meeting")).toBe("Internal Meeting");
  });

  it("collapses internal whitespace runs to a single space", () => {
    expect(repo.normalizeTaskName("internal   meeting")).toBe("internal meeting");
  });

  it("free text that happens to have no dash is still accepted verbatim", () => {
    expect(repo.normalizeTaskName("abcdefgh")).toBe("abcdefgh");
  });

  it("free text with spaces after a dash is accepted verbatim (not slug-shaped)", () => {
    expect(repo.normalizeTaskName("abc-some thing")).toBe("abc-some thing");
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

  it("creates a free-text task verbatim on first use", () => {
    const task = repo.findOrCreateTask("Internal Meeting");
    expect(task.name).toBe("Internal Meeting");
  });

  it("matches free-text tasks case-insensitively, first-seen casing wins", () => {
    const first = repo.findOrCreateTask("Internal Meeting");
    const second = repo.findOrCreateTask("internal meeting");
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Internal Meeting");
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

  it("finds free-text tasks by substring", () => {
    repo.createEntry({
      userId: userA.id,
      task: "Internal Meeting",
      startedAt: "2026-01-04T09:00:00.000Z",
      stoppedAt: "2026-01-04T10:00:00.000Z",
    });
    const tasksForA = repo.listTasksForUser(userA.id, "meet");
    expect(tasksForA.map((t) => t.name)).toEqual(["Internal Meeting"]);
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

  it("rejects a too-short task name", () => {
    expectApiError(
      () =>
        repo.createEntry({
          userId: userA.id,
          task: "a",
          startedAt: "2026-01-01T09:00:00.000Z",
          stoppedAt: "2026-01-01T10:00:00.000Z",
        }),
      400
    );
  });

  it("creates a valid manual entry with a free-text task name", () => {
    const entry = repo.createEntry({
      userId: userA.id,
      task: "not a valid slug",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    expect(entry.taskName).toBe("not a valid slug");
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

  it("joins the owning user's current project as userProject (v2.5)", () => {
    repo.updateUser(userA.id, { project: "AI Assessor" });
    const entries = repo.listEntries({ userId: userA.id });
    expect(entries.every((e) => e.userProject === "AI Assessor")).toBe(true);

    const bobEntries = repo.listEntries({ userId: userB.id });
    expect(bobEntries.every((e) => e.userProject === null)).toBe(true);
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

  it("counts distinct tasks per user and overall in user grouping", () => {
    // userA works a second, shared task so per-user counts and the distinct
    // overall count diverge from a naive sum.
    repo.createEntry({
      userId: userA.id,
      task: "ab26-beta",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T10:00:00.000Z",
    });
    const result = repo.report({ groupBy: "user" });
    const a = result.groups.find((g) => g.id === userA.id)!;
    const b = result.groups.find((g) => g.id === userB.id)!;
    expect(a.taskCount).toBe(2); // alpha + beta (running alpha entry excluded, but completed alpha counts)
    expect(b.taskCount).toBe(1); // beta only
    expect(result.distinctTaskCount).toBe(2); // alpha, beta — not 3
  });

  it("sets distinctTaskCount to the group count in task grouping and leaves taskCount unset", () => {
    const result = repo.report({ userId: userA.id, groupBy: "task" });
    expect(result.distinctTaskCount).toBe(result.groups.length);
    expect(result.groups[0].taskCount).toBeUndefined();
  });

  it("attaches the user's current project to groupBy=user groups (v2.5)", () => {
    repo.updateUser(userA.id, { project: "AI Assessor" });
    const result = repo.report({ groupBy: "user" });
    const a = result.groups.find((g) => g.id === userA.id)!;
    const b = result.groups.find((g) => g.id === userB.id)!;
    expect(a.project).toBe("AI Assessor");
    expect(b.project).toBeNull();
  });
});

describe("report — dates + recency sort (v2.1)", () => {
  it("attaches distinct ascending local dates and lastWorked per task group", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab27-multi-day",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab27-multi-day",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab27-multi-day",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T10:00:00.000Z",
    });

    const result = repo.report({ userId: userA.id, groupBy: "task" });
    const group = result.groups.find((g) => g.name === "AB27-multi-day")!;
    expect(group.dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
    expect(group.lastWorked).toBe("2026-01-03");
  });

  it("sorts all groups by most recent activity desc, regardless of total hours", () => {
    // Task alpha: 5 hours total, but last worked earlier.
    repo.createEntry({
      userId: userA.id,
      task: "ab28-alpha-big",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T14:00:00.000Z",
    });
    // Task beta: only 0.5h, but worked most recently.
    repo.createEntry({
      userId: userA.id,
      task: "ab29-beta-small",
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T09:30:00.000Z",
    });

    const result = repo.report({ userId: userA.id, groupBy: "task" });
    expect(result.groups.map((g) => g.name)).toEqual(["AB29-beta-small", "AB28-alpha-big"]);
  });

  it("sorts user groups by most recent activity desc too", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab30-a-early",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T15:00:00.000Z", // 6h, but earlier
    });
    repo.createEntry({
      userId: userB.id,
      task: "ab31-b-late",
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T09:30:00.000Z", // 0.5h, but most recent
    });

    const result = repo.report({ groupBy: "user" });
    expect(result.groups.map((g) => g.id)).toEqual([userB.id, userA.id]);
  });
});

describe("report — admin all-users task aggregation (v2.2)", () => {
  it("aggregates hours per task across every user and attaches sorted contributors", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab40-shared",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z", // 1h, Alice
    });
    repo.createEntry({
      userId: userB.id,
      task: "ab40-shared",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T11:00:00.000Z", // 2h, Bob
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab41-solo",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T09:30:00.000Z", // 0.5h, Alice only
    });

    const result = repo.report({ userId: "all", groupBy: "task" });
    expect(result.totalHours).toBe(3.5);

    const shared = result.groups.find((g) => g.name === "AB40-shared")!;
    expect(shared.hours).toBe(3);
    expect(shared.contributors).toEqual([
      { id: userB.id, name: "Bob", hours: 2 },
      { id: userA.id, name: "Alice", hours: 1 },
    ]);

    const solo = result.groups.find((g) => g.name === "AB41-solo")!;
    expect(solo.hours).toBe(0.5);
    expect(solo.contributors).toEqual([{ id: userA.id, name: "Alice", hours: 0.5 }]);
  });

  it("sums a single contributor's repeated entries into one contributor row", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab42-repeat",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab42-repeat",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T10:00:00.000Z",
    });

    const result = repo.report({ userId: "all", groupBy: "task" });
    const group = result.groups.find((g) => g.name === "AB42-repeat")!;
    expect(group.contributors).toEqual([{ id: userA.id, name: "Alice", hours: 2 }]);
  });

  it("leaves contributors unset for single-user task reports and for groupBy=user", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab43-self",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });

    const selfReport = repo.report({ userId: userA.id, groupBy: "task" });
    expect(selfReport.groups[0].contributors).toBeUndefined();

    const userReport = repo.report({ groupBy: "user" });
    expect(userReport.groups[0].contributors).toBeUndefined();
  });
});

describe("listEntries with userId=all", () => {
  it("returns every user's entries, same as omitting userId", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab44-a",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userB.id,
      task: "ab45-b",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });

    const all = repo.listEntries({ userId: "all" });
    const omitted = repo.listEntries({});
    expect(all.length).toBe(2);
    expect(all.map((e) => e.id).sort()).toEqual(omitted.map((e) => e.id).sort());
  });
});

describe("setTimesheetCell", () => {
  it("creates a synthetic 09:00-local entry for a fresh cell", () => {
    const result = repo.setTimesheetCell({
      userId: userA.id,
      task: "ab32-timesheet-new",
      date: "2026-01-06",
      hours: 3,
    });
    expect(result.hours).toBe(3);

    const entries = repo
      .listEntries({ userId: userA.id })
      .filter((e) => e.taskName === "AB32-timesheet-new");
    expect(entries.length).toBe(1);
    expect(entries[0].durationSecs).toBe(3 * 3600);
    const started = new Date(entries[0].startedAt);
    expect(started.getHours()).toBe(9);
    expect(started.getMinutes()).toBe(0);
  });

  it("rounds hours to the nearest 0.5h step", () => {
    const result = repo.setTimesheetCell({
      userId: userA.id,
      task: "ab33-timesheet-round",
      date: "2026-01-06",
      hours: 3.2,
    });
    expect(result.hours).toBe(3);
  });

  it("replaces multiple existing completed entries for that task+day with a single one", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab34-timesheet-multi",
      startedAt: "2026-01-06T09:00:00.000Z",
      stoppedAt: "2026-01-06T10:00:00.000Z",
    });
    repo.createEntry({
      userId: userA.id,
      task: "ab34-timesheet-multi",
      startedAt: "2026-01-06T14:00:00.000Z",
      stoppedAt: "2026-01-06T15:00:00.000Z",
    });
    // a different day for the same task must be left alone
    repo.createEntry({
      userId: userA.id,
      task: "ab34-timesheet-multi",
      startedAt: "2026-01-07T09:00:00.000Z",
      stoppedAt: "2026-01-07T10:00:00.000Z",
    });

    const result = repo.setTimesheetCell({
      userId: userA.id,
      task: "ab34-timesheet-multi",
      date: "2026-01-06",
      hours: 2.5,
    });
    expect(result.hours).toBe(2.5);

    const entries = repo
      .listEntries({ userId: userA.id })
      .filter((e) => e.taskName === "AB34-timesheet-multi");
    expect(entries.length).toBe(2); // the untouched other-day entry + the new single one
    const jan6 = entries.filter((e) => e.startedAt.startsWith("2026-01-06"));
    expect(jan6.length).toBe(1);
    expect(jan6[0].durationSecs).toBe(2.5 * 3600);
    const jan7 = entries.find((e) => e.startedAt.startsWith("2026-01-07"));
    expect(jan7).toBeTruthy();
  });

  it("clears a cell (deletes entries, inserts nothing) when hours is 0", () => {
    repo.createEntry({
      userId: userA.id,
      task: "ab35-timesheet-clear",
      startedAt: "2026-01-06T09:00:00.000Z",
      stoppedAt: "2026-01-06T10:00:00.000Z",
    });

    const result = repo.setTimesheetCell({
      userId: userA.id,
      task: "ab35-timesheet-clear",
      date: "2026-01-06",
      hours: 0,
    });
    expect(result.hours).toBe(0);

    const entries = repo
      .listEntries({ userId: userA.id })
      .filter((e) => e.taskName === "AB35-timesheet-clear");
    expect(entries.length).toBe(0);
  });

  it("never touches or counts a running entry for the same task+day", () => {
    const running = repo.startTimer({ userId: userA.id, task: "ab36-timesheet-running" });

    const result = repo.setTimesheetCell({
      userId: userA.id,
      task: "ab36-timesheet-running",
      date: new Date(running.startedAt).toISOString().slice(0, 10),
      hours: 2,
    });
    expect(result.hours).toBe(2);

    // The running entry must still be running, untouched by the replace.
    const stillRunning = repo.getRunningEntry(userA.id);
    expect(stillRunning?.id).toBe(running.id);
    expect(stillRunning?.stoppedAt).toBeNull();

    const completed = repo
      .listEntries({ userId: userA.id })
      .filter((e) => e.taskName === "AB36-timesheet-running" && e.stoppedAt !== null);
    expect(completed.length).toBe(1);
    expect(completed[0].durationSecs).toBe(2 * 3600);
  });

  it("rejects negative hours", () => {
    expectApiError(
      () => repo.setTimesheetCell({ userId: userA.id, task: "ab37-neg", date: "2026-01-06", hours: -1 }),
      400
    );
  });

  it("rejects hours over 24", () => {
    expectApiError(
      () => repo.setTimesheetCell({ userId: userA.id, task: "ab38-over", date: "2026-01-06", hours: 25 }),
      400
    );
  });

  it("rejects a too-short task name", () => {
    expectApiError(
      () => repo.setTimesheetCell({ userId: userA.id, task: "a", date: "2026-01-06", hours: 2 }),
      400
    );
  });

  it("works with a free-text task name", () => {
    const result = repo.setTimesheetCell({
      userId: userA.id,
      task: "Internal Meeting",
      date: "2026-01-06",
      hours: 2,
    });
    expect(result.hours).toBe(2);
    const entries = repo
      .listEntries({ userId: userA.id })
      .filter((e) => e.taskName === "Internal Meeting");
    expect(entries.length).toBe(1);
  });

  it("rejects a malformed date", () => {
    expectApiError(
      () => repo.setTimesheetCell({ userId: userA.id, task: "ab39-bad-date", date: "01/06/2026", hours: 2 }),
      400
    );
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
