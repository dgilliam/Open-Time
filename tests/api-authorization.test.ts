// Route-handler-level tests: "authorization enforced in routes" (see
// docs/PLAN.md) means the interesting behavior — a member getting a 403 when
// targeting another user's data, admin-only endpoints — lives in the route
// files themselves, not in repo.ts. These tests call the route handlers
// directly (no HTTP server needed; Next.js route handlers are plain async
// functions) with a real session cookie to exercise that enforcement.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-authz-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;

const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const auth = await import("../src/lib/auth");
const entriesRoute = await import("../src/app/api/entries/route");
const calendarRoute = await import("../src/app/api/calendar/route");
const usersRoute = await import("../src/app/api/users/route");
const userByIdRoute = await import("../src/app/api/users/[id]/route");
const reportsRoute = await import("../src/app/api/reports/route");
const reportsCsvRoute = await import("../src/app/api/reports/csv/route");
const tasksRoute = await import("../src/app/api/tasks/route");
const taskByIdRoute = await import("../src/app/api/tasks/[id]/route");

function resetDb() {
  db.exec("DELETE FROM time_entries; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;");
}

function req(
  url: string,
  opts: { token?: string; method?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["cookie"] = `${auth.SESSION_COOKIE}=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost"), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

let admin: ReturnType<typeof repo.createUser>;
let userA: ReturnType<typeof repo.createUser>;
let userB: ReturnType<typeof repo.createUser>;
let adminToken: string;
let tokenA: string;
let tokenB: string;

beforeEach(() => {
  resetDb();
  admin = repo.createUser({ name: "Drew", email: "admin@reposcout.dev", password: "opentime-dev", role: "admin" });
  userA = repo.createUser({ name: "Alice", email: "alice@example.com", password: "password123", role: "member" });
  userB = repo.createUser({ name: "Bob", email: "bob@example.com", password: "password123", role: "member" });
  adminToken = auth.createSession(admin.id).token;
  tokenA = auth.createSession(userA.id).token;
  tokenB = auth.createSession(userB.id).token;

  repo.createEntry({
    userId: userB.id,
    task: "ab1-bobs-task",
    startedAt: "2026-01-01T09:00:00.000Z",
    stoppedAt: "2026-01-01T10:00:00.000Z",
  });
});

afterAll(() => {
  db.close();
  if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
  const wal = `${tmpDbPath}-wal`;
  const shm = `${tmpDbPath}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
});

describe("GET /api/entries authorization", () => {
  it("401s with no session", async () => {
    const res = await entriesRoute.GET(req(`/api/entries?userId=${userB.id}`));
    expect(res.status).toBe(401);
  });

  it("403s when a member targets another user's entries", async () => {
    const res = await entriesRoute.GET(req(`/api/entries?userId=${userB.id}`, { token: tokenA }));
    expect(res.status).toBe(403);
  });

  it("200s when a member reads their own entries", async () => {
    const res = await entriesRoute.GET(req(`/api/entries?userId=${userB.id}`, { token: tokenB }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
  });

  it("200s when an admin targets another user's entries", async () => {
    const res = await entriesRoute.GET(req(`/api/entries?userId=${userB.id}`, { token: adminToken }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
  });

  it("defaults to the caller's own entries when userId is omitted", async () => {
    const res = await entriesRoute.GET(req(`/api/entries`, { token: tokenA }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});

describe("POST /api/entries with userId (v3.3 admin add-for-member)", () => {
  const body = {
    task: "zz90-backfilled-by-admin",
    startedAt: "2026-07-06T16:00:00.000Z",
    stoppedAt: "2026-07-06T17:00:00.000Z",
  };

  it("admin creates an entry for a member; the entry belongs to the member", async () => {
    const res = await entriesRoute.POST(
      req("/api/entries", { token: adminToken, method: "POST", body: { ...body, userId: userB.id } })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.userId).toBe(userB.id);
    expect(repo.listEntries({ userId: userB.id })).toHaveLength(2); // seeded one + this
  });

  it("403s a member creating an entry for someone else", async () => {
    const res = await entriesRoute.POST(
      req("/api/entries", { token: tokenA, method: "POST", body: { ...body, userId: userB.id } })
    );
    expect(res.status).toBe(403);
  });

  it("a member passing their own userId is allowed (equivalent to omitting it)", async () => {
    const res = await entriesRoute.POST(
      req("/api/entries", { token: tokenA, method: "POST", body: { ...body, userId: userA.id } })
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.userId).toBe(userA.id);
  });

  it("omitting userId still creates for the caller", async () => {
    const res = await entriesRoute.POST(req("/api/entries", { token: tokenA, method: "POST", body }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.userId).toBe(userA.id);
  });
});

describe("GET /api/entries?userId=all authorization (v2.2 admin dashboard)", () => {
  it("403s a member requesting userId=all", async () => {
    const res = await entriesRoute.GET(req(`/api/entries?userId=all`, { token: tokenA }));
    expect(res.status).toBe(403);
  });

  it("200s for admin and returns every user's entries", async () => {
    await repo.createEntry({
      userId: userA.id,
      task: "ab46-alice-task",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    const res = await entriesRoute.GET(req(`/api/entries?userId=all`, { token: adminToken }));
    expect(res.status).toBe(200);
    const json = await res.json();
    // 1 entry from beforeEach (userB) + 1 just created (userA).
    expect(json.data.length).toBe(2);
    expect(json.data.map((e: { userId: string }) => e.userId).sort()).toEqual([userA.id, userB.id].sort());
  });
});

describe("GET /api/calendar authorization", () => {
  it("403s when a member targets another user's calendar", async () => {
    const res = await calendarRoute.GET(req(`/api/calendar?userId=${userB.id}`, { token: tokenA }));
    expect(res.status).toBe(403);
  });

  it("200s for admin targeting any user", async () => {
    const res = await calendarRoute.GET(req(`/api/calendar?userId=${userB.id}`, { token: adminToken }));
    expect(res.status).toBe(200);
  });
});

describe("/api/users authorization (admin only)", () => {
  it("403s a member listing users", async () => {
    const res = await usersRoute.GET(req("/api/users", { token: tokenA }));
    expect(res.status).toBe(403);
  });

  it("401s with no session", async () => {
    const res = await usersRoute.GET(req("/api/users"));
    expect(res.status).toBe(401);
  });

  it("200s for admin", async () => {
    const res = await usersRoute.GET(req("/api/users", { token: adminToken }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(3);
  });
});

describe("PATCH /api/users/[id] authorization (admin only, v2.5)", () => {
  it("403s a member", async () => {
    const res = await userByIdRoute.PATCH(
      req(`/api/users/${userB.id}`, { method: "PATCH", token: tokenA, body: { project: "Platform" } }),
      { params: Promise.resolve({ id: userB.id }) }
    );
    expect(res.status).toBe(403);
  });

  it("401s with no session", async () => {
    const res = await userByIdRoute.PATCH(
      req(`/api/users/${userB.id}`, { method: "PATCH", body: { project: "Platform" } }),
      { params: Promise.resolve({ id: userB.id }) }
    );
    expect(res.status).toBe(401);
  });

  it("200s for admin, updating the target user's project", async () => {
    const res = await userByIdRoute.PATCH(
      req(`/api/users/${userB.id}`, { method: "PATCH", token: adminToken, body: { project: "Platform" } }),
      { params: Promise.resolve({ id: userB.id }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.project).toBe("Platform");
  });

  it("404s for an unknown user id", async () => {
    const res = await userByIdRoute.PATCH(
      req(`/api/users/nope`, { method: "PATCH", token: adminToken, body: { project: "Platform" } }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/users/[id] and restore (admin only, v2.7 soft-delete)", () => {
  it("403s a member", async () => {
    const res = await userByIdRoute.DELETE(
      req(`/api/users/${userB.id}`, { method: "DELETE", token: tokenA }),
      { params: Promise.resolve({ id: userB.id }) }
    );
    expect(res.status).toBe(403);
  });

  it("401s with no session", async () => {
    const res = await userByIdRoute.DELETE(req(`/api/users/${userB.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: userB.id }),
    });
    expect(res.status).toBe(401);
  });

  it("400s an admin targeting themselves", async () => {
    const res = await userByIdRoute.DELETE(
      req(`/api/users/${admin.id}`, { method: "DELETE", token: adminToken }),
      { params: Promise.resolve({ id: admin.id }) }
    );
    expect(res.status).toBe(400);
  });

  it("200s an admin removing a member; the member's login and session stop resolving", async () => {
    const res = await userByIdRoute.DELETE(
      req(`/api/users/${userB.id}`, { method: "DELETE", token: adminToken }),
      { params: Promise.resolve({ id: userB.id }) }
    );
    expect(res.status).toBe(200);

    // The member's live session (tokenB, created in beforeEach) must stop
    // resolving immediately.
    expect(auth.getSessionUser(tokenB)).toBeNull();
    expect(repo.getUserAuthByEmail("bob@example.com")).toBeNull();
  });

  it("GET /api/users?includeRemoved=1 includes the removed row, flagged", async () => {
    await userByIdRoute.DELETE(req(`/api/users/${userB.id}`, { method: "DELETE", token: adminToken }), {
      params: Promise.resolve({ id: userB.id }),
    });

    const defaultRes = await usersRoute.GET(req("/api/users", { token: adminToken }));
    const defaultJson = await defaultRes.json();
    expect(defaultJson.data.map((u: { id: string }) => u.id)).not.toContain(userB.id);

    const includeRes = await usersRoute.GET(
      req("/api/users?includeRemoved=1", { token: adminToken })
    );
    expect(includeRes.status).toBe(200);
    const includeJson = await includeRes.json();
    const removedRow = includeJson.data.find((u: { id: string }) => u.id === userB.id);
    expect(removedRow).toBeTruthy();
    expect(removedRow.deletedAt).not.toBeNull();
  });

  it("PATCH {restore: true} brings a removed member back (admin only)", async () => {
    await userByIdRoute.DELETE(req(`/api/users/${userB.id}`, { method: "DELETE", token: adminToken }), {
      params: Promise.resolve({ id: userB.id }),
    });

    const res = await userByIdRoute.PATCH(
      req(`/api/users/${userB.id}`, { method: "PATCH", token: adminToken, body: { restore: true } }),
      { params: Promise.resolve({ id: userB.id }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deletedAt).toBeNull();
    expect(repo.getUserAuthByEmail("bob@example.com")).not.toBeNull();
  });

  it("a removed member's entries still appear via GET /api/entries?userId=all", async () => {
    await userByIdRoute.DELETE(req(`/api/users/${userB.id}`, { method: "DELETE", token: adminToken }), {
      params: Promise.resolve({ id: userB.id }),
    });

    const res = await entriesRoute.GET(req(`/api/entries?userId=all`, { token: adminToken }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.some((e: { userId: string }) => e.userId === userB.id)).toBe(true);
  });
});

describe("GET /api/reports groupBy=user authorization (admin only)", () => {
  it("403s a member", async () => {
    const res = await reportsRoute.GET(req("/api/reports?groupBy=user", { token: tokenA }));
    expect(res.status).toBe(403);
  });

  it("200s for admin", async () => {
    const res = await reportsRoute.GET(req("/api/reports?groupBy=user", { token: adminToken }));
    expect(res.status).toBe(200);
  });

  it("403s a member targeting another user's task report", async () => {
    const res = await reportsRoute.GET(
      req(`/api/reports?groupBy=task&userId=${userB.id}`, { token: tokenA })
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/reports?groupBy=task&userId=all authorization (v2.2 admin dashboard)", () => {
  it("403s a member requesting userId=all", async () => {
    const res = await reportsRoute.GET(
      req(`/api/reports?groupBy=task&userId=all`, { token: tokenA })
    );
    expect(res.status).toBe(403);
  });

  it("200s for admin with contributors aggregated across every user", async () => {
    await repo.createEntry({
      userId: userA.id,
      task: "ab47-cross-team",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z", // 1h
    });
    // beforeEach already logged userB 1h on "ab1-bobs-task"; add userB time
    // on the same task as userA so contributors has two entries to sort.
    await repo.createEntry({
      userId: userB.id,
      task: "ab47-cross-team",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T11:00:00.000Z", // 2h
    });

    const res = await reportsRoute.GET(
      req(`/api/reports?groupBy=task&userId=all`, { token: adminToken })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const group = json.data.groups.find((g: { name: string }) => g.name === "AB47-cross-team");
    expect(group.hours).toBe(3);
    expect(group.contributors).toEqual([
      { id: userB.id, name: "Bob", hours: 2 },
      { id: userA.id, name: "Alice", hours: 1 },
    ]);
  });
});

describe("GET /api/reports/csv authorization and content (v2.4)", () => {
  it("403s a member requesting userId=all", async () => {
    const res = await reportsCsvRoute.GET(req(`/api/reports/csv?userId=all`, { token: tokenA }));
    expect(res.status).toBe(403);
  });

  it("403s a member targeting another user's export", async () => {
    const res = await reportsCsvRoute.GET(
      req(`/api/reports/csv?userId=${userB.id}`, { token: tokenA })
    );
    expect(res.status).toBe(403);
  });

  it("200s a member exporting their own entries, header row + only their rows", async () => {
    // beforeEach already logged userB 1h on "ab1-bobs-task"; add an userA
    // entry so we can confirm B's export doesn't leak A's row.
    await repo.createEntry({
      userId: userA.id,
      task: "ab46-alice-task",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(req(`/api/reports/csv`, { token: tokenB }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("member,project,task,task_status,task_link,task_details,duration_hours,date");
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("Bob,,AB1-bobs-task,open,,,1,2026-01-01");
  });

  it("includes the member's assigned project in its column", async () => {
    await repo.updateUser(userB.id, { project: "Platform" });

    const res = await reportsCsvRoute.GET(req(`/api/reports/csv`, { token: tokenB }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[1]).toBe("Bob,Platform,AB1-bobs-task,open,,,1,2026-01-01");
  });

  it("200s for admin with userId=all, containing multiple members", async () => {
    await repo.createEntry({
      userId: userA.id,
      task: "ab46-alice-task",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(
      req(`/api/reports/csv?userId=all`, { token: adminToken })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("member,project,task,task_status,task_link,task_details,duration_hours,date");
    const members = lines.slice(1).map((line) => line.split(",")[0]);
    expect(new Set(members)).toEqual(new Set(["Alice", "Bob"]));
  });

  it("CSV-escapes a free-text task containing a comma", async () => {
    await repo.createEntry({
      userId: userA.id,
      task: "meeting, planning",
      startedAt: "2026-01-04T09:00:00.000Z",
      stoppedAt: "2026-01-04T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(req(`/api/reports/csv`, { token: tokenA }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[1]).toBe('Alice,,"meeting, planning",open,,,1,2026-01-04');
  });

  it("populates task_status/task_link/task_details from the task's wrap-up metadata", async () => {
    const entry = await repo.createEntry({
      userId: userA.id,
      task: "ab50-wrapped-task",
      startedAt: "2026-01-04T09:00:00.000Z",
      stoppedAt: "2026-01-04T10:00:00.000Z",
    });
    await repo.updateTask(
      entry.taskId,
      { id: admin.id, role: "admin" },
      { status: "accepted", link: "https://reposcout.slack.com/archives/C1/p1", details: "all done" }
    );

    const res = await reportsCsvRoute.GET(req(`/api/reports/csv`, { token: tokenA }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[1]).toBe(
      "Alice,,AB50-wrapped-task,accepted,https://reposcout.slack.com/archives/C1/p1,all done,1,2026-01-04"
    );
  });

  it("quotes task_details containing a newline so it survives round-trip", async () => {
    const entry = await repo.createEntry({
      userId: userA.id,
      task: "ab51-multiline-details",
      startedAt: "2026-01-04T09:00:00.000Z",
      stoppedAt: "2026-01-04T10:00:00.000Z",
    });
    await repo.updateTask(
      entry.taskId,
      { id: admin.id, role: "admin" },
      { status: "submitted", details: "line one\nline two" }
    );

    const res = await reportsCsvRoute.GET(req(`/api/reports/csv`, { token: tokenA }));
    expect(res.status).toBe(200);
    const text = await res.text();
    // The embedded newline means this row spans two physical lines within one
    // quoted CSV field — a naive split("\n") would (incorrectly) see it as
    // two rows. Assert on the raw text instead of a line-split.
    expect(text).toContain('AB51-multiline-details,submitted,,"line one\nline two",1,2026-01-04');
  });

  it("orders rows by date ascending", async () => {
    await repo.createEntry({
      userId: userB.id,
      task: "ab48-later-task",
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T10:00:00.000Z",
    });
    await repo.createEntry({
      userId: userB.id,
      task: "ab49-earliest-task",
      startedAt: "2025-12-30T09:00:00.000Z",
      stoppedAt: "2025-12-30T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(req(`/api/reports/csv`, { token: tokenB }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    const dates = lines.slice(1).map((line) => line.split(",").pop());
    expect(dates).toEqual([...dates].sort());
  });
});

describe("GET /api/reports/csv?project= (v2.4 addendum, dashboard entries export)", () => {
  it("project=<label> returns only entries of members with that project", async () => {
    await repo.updateUser(userA.id, { project: "Platform" });
    await repo.updateUser(userB.id, { project: "AI Assessor" });
    await repo.createEntry({
      userId: userA.id,
      task: "ab46-alice-task",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(
      req(`/api/reports/csv?userId=all&project=Platform`, { token: adminToken })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("Alice,Platform,AB46-alice-task,open,,,1,2026-01-03");
  });

  it("project=__none__ returns only unassigned members' entries", async () => {
    await repo.updateUser(userA.id, { project: "Platform" });
    // userB stays unassigned; beforeEach already logged userB's entry.
    await repo.createEntry({
      userId: userA.id,
      task: "ab46-alice-task",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(
      req(`/api/reports/csv?userId=all&project=__none__`, { token: adminToken })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("Bob,,AB1-bobs-task,open,,,1,2026-01-01");
  });

  it("composes with userId=all and no project filter (absent = off)", async () => {
    await repo.updateUser(userA.id, { project: "Platform" });
    await repo.createEntry({
      userId: userA.id,
      task: "ab46-alice-task",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(
      req(`/api/reports/csv?userId=all`, { token: adminToken })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(3);
  });

  it("a member's export stays self-scoped only, even with a project filter set", async () => {
    await repo.updateUser(userA.id, { project: "Platform" });
    await repo.updateUser(userB.id, { project: "Platform" });
    await repo.createEntry({
      userId: userA.id,
      task: "ab46-alice-task",
      startedAt: "2026-01-03T09:00:00.000Z",
      stoppedAt: "2026-01-03T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(
      req(`/api/reports/csv?project=Platform`, { token: tokenB })
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    // Self-scope (targetUserId defaults to Bob) still applies: only Bob's row,
    // never Alice's, even though both share the "Platform" project.
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("Bob,Platform,AB1-bobs-task,open,,,1,2026-01-01");
  });

  it("403s a member attempting userId=all with a project filter", async () => {
    const res = await reportsCsvRoute.GET(
      req(`/api/reports/csv?userId=all&project=Platform`, { token: tokenA })
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/tasks scoping", () => {
  it("only returns the current session user's own tasks", async () => {
    const res = await tasksRoute.GET(req("/api/tasks", { token: tokenB }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.map((t: { name: string }) => t.name)).toEqual(["AB1-bobs-task"]);

    const resA = await tasksRoute.GET(req("/api/tasks", { token: tokenA }));
    const jsonA = await resA.json();
    expect(jsonA.data).toEqual([]);
  });
});

describe("PATCH /api/tasks/[id] authorization (v2.6 wrap-up metadata)", () => {
  it("401s with no session", async () => {
    // beforeEach logged userB's entry on "ab1-bobs-task".
    const bobsTask = repo.listTasksForUser(userB.id, "")[0];
    const res = await taskByIdRoute.PATCH(
      req(`/api/tasks/${bobsTask.id}`, { method: "PATCH", body: { status: "accepted" } }),
      { params: Promise.resolve({ id: bobsTask.id }) }
    );
    expect(res.status).toBe(401);
  });

  it("403s a member with no entry on the task", async () => {
    const bobsTask = repo.listTasksForUser(userB.id, "")[0];
    const res = await taskByIdRoute.PATCH(
      req(`/api/tasks/${bobsTask.id}`, { method: "PATCH", token: tokenA, body: { status: "accepted" } }),
      { params: Promise.resolve({ id: bobsTask.id }) }
    );
    expect(res.status).toBe(403);
  });

  it("200s a contributor (member with an entry on the task)", async () => {
    const bobsTask = repo.listTasksForUser(userB.id, "")[0];
    const res = await taskByIdRoute.PATCH(
      req(`/api/tasks/${bobsTask.id}`, {
        method: "PATCH",
        token: tokenB,
        body: { status: "submitted", link: "https://reposcout.slack.com/archives/C1/p1" },
      }),
      { params: Promise.resolve({ id: bobsTask.id }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe("submitted");
    expect(json.data.link).toBe("https://reposcout.slack.com/archives/C1/p1");
  });

  it("200s for admin regardless of entry ownership", async () => {
    const bobsTask = repo.listTasksForUser(userB.id, "")[0];
    const res = await taskByIdRoute.PATCH(
      req(`/api/tasks/${bobsTask.id}`, {
        method: "PATCH",
        token: adminToken,
        body: { status: "dead_end", details: "closing this out" },
      }),
      { params: Promise.resolve({ id: bobsTask.id }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe("dead_end");
    expect(json.data.details).toBe("closing this out");
  });

  it("404s for an unknown task id", async () => {
    const res = await taskByIdRoute.PATCH(
      req(`/api/tasks/nope`, { method: "PATCH", token: adminToken, body: { status: "accepted" } }),
      { params: Promise.resolve({ id: "nope" }) }
    );
    expect(res.status).toBe(404);
  });

  it("400s an invalid status", async () => {
    const bobsTask = repo.listTasksForUser(userB.id, "")[0];
    const res = await taskByIdRoute.PATCH(
      req(`/api/tasks/${bobsTask.id}`, { method: "PATCH", token: adminToken, body: { status: "in_progress" } }),
      { params: Promise.resolve({ id: bobsTask.id }) }
    );
    expect(res.status).toBe(400);
  });
});
