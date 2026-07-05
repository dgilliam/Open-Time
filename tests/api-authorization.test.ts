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
  admin = repo.createUser({ name: "Drew", email: "drew@gilli.am", password: "opentime-dev", role: "admin" });
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
    expect(lines[0]).toBe("member,project,task,duration_hours,date");
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("Bob,,AB1-bobs-task,1,2026-01-01");
  });

  it("includes the member's assigned project in its column", async () => {
    await repo.updateUser(userB.id, { project: "Platform" });

    const res = await reportsCsvRoute.GET(req(`/api/reports/csv`, { token: tokenB }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n");
    expect(lines[1]).toBe("Bob,Platform,AB1-bobs-task,1,2026-01-01");
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
    expect(lines[0]).toBe("member,project,task,duration_hours,date");
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
    expect(lines[1]).toBe('Alice,,"meeting, planning",1,2026-01-04');
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
