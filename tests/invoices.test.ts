// Invoice periods (docs/PLAN.md v2.8): Pacific cutoff math, the sweep/
// scheduler in src/lib/invoices.ts, and the locking it imposes on repo.ts's
// updateEntry/deleteEntry/setTimesheetCell. Same temp-DB pattern as the
// other test files — each test file gets its own module registry, so
// OPENTIME_DB must be set before the first `import("../src/lib/db")`.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const tmpDbPath = path.join(os.tmpdir(), `opentime-invoices-test-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;

const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const auth = await import("../src/lib/auth");
const invoices = await import("../src/lib/invoices");
const { ApiError } = await import("../src/lib/types");
const invoicesRoute = await import("../src/app/api/invoices/route");
const invoiceByIdRoute = await import("../src/app/api/invoices/[id]/route");
const invoiceCsvRoute = await import("../src/app/api/invoices/[id]/csv/route");

function resetDb() {
  db.exec(
    "DELETE FROM time_entries; DELETE FROM invoice_periods; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;"
  );
}

function expectApiError(fn: () => unknown, status: number, messageIncludes?: string) {
  try {
    fn();
    expect.fail("should have thrown");
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).status).toBe(status);
    if (messageIncludes) {
      expect((err as InstanceType<typeof ApiError>).message).toContain(messageIncludes);
    }
  }
}

function req(url: string, opts: { token?: string; method?: string; body?: unknown } = {}) {
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
let member: ReturnType<typeof repo.createUser>;

beforeEach(() => {
  resetDb();
  admin = repo.createUser({ name: "Drew", email: "drew@gilli.am", password: "opentime-dev", role: "admin" });
  member = repo.createUser({ name: "Alice", email: "alice@example.com", password: "password123", role: "member" });
});

afterAll(() => {
  db.close();
  for (const f of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe("Pacific cutoff math (DST)", () => {
  it("spring-forward Sunday (2026-03-08, PDT begins) cutoffs to 06:59 UTC Monday", () => {
    // 2026's US spring-forward is the 2nd Sunday of March = March 8. By
    // 23:59 that day the 2am local transition has already happened, so the
    // cutoff instant is in PDT (UTC-7): 23:59 + 7h = 06:59 UTC the next day.
    const cutoff = invoices.cutoffForLabel("2026-03-08");
    expect(cutoff.toISOString()).toBe("2026-03-09T06:59:00.000Z");
  });

  it("fall-back Sunday (2026-11-01, PST resumes) cutoffs to 07:59 UTC Monday", () => {
    // 2026's US fall-back is the 1st Sunday of November = November 1. By
    // 23:59 that day the 2am local transition has already happened, so the
    // cutoff instant is in PST (UTC-8): 23:59 + 8h = 07:59 UTC the next day.
    const cutoff = invoices.cutoffForLabel("2026-11-01");
    expect(cutoff.toISOString()).toBe("2026-11-02T07:59:00.000Z");
  });

  it("an ordinary mid-winter Sunday (PST) also cutoffs to 07:59 UTC Monday", () => {
    const cutoff = invoices.cutoffForLabel("2026-01-04");
    expect(cutoff.toISOString()).toBe("2026-01-05T07:59:00.000Z");
  });

  it("an ordinary mid-summer Sunday (PDT) also cutoffs to 06:59 UTC Monday", () => {
    const cutoff = invoices.cutoffForLabel("2026-07-05");
    expect(cutoff.toISOString()).toBe("2026-07-06T06:59:00.000Z");
  });
});

describe("createMissingPeriods — bootstrap", () => {
  it("creates only the most recent past cutoff period, sweeping ALL prior uninvoiced completed entries", () => {
    repo.createEntry({
      userId: member.id,
      task: "ab1-ancient-history",
      startedAt: "2025-11-01T09:00:00.000Z",
      stoppedAt: "2025-11-01T10:00:00.000Z",
    });
    repo.createEntry({
      userId: member.id,
      task: "ab2-recent-history",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    // Not yet before the bootstrap cutoff's week — must stay unswept.
    repo.createEntry({
      userId: member.id,
      task: "ab3-this-week",
      startedAt: "2026-01-06T09:00:00.000Z",
      stoppedAt: "2026-01-06T10:00:00.000Z",
    });

    // now = Jan 6, between the Jan-4 cutoff (already past) and the Jan-11
    // cutoff (still future) — bootstrap should land on exactly one period,
    // labeled 2026-01-04.
    const created = invoices.createMissingPeriods(new Date("2026-01-06T00:00:00.000Z"));
    expect(created.length).toBe(1);
    expect(created[0].label).toBe("2026-01-04");
    expect(created[0].locked).toBe(true);

    const periods = invoices.listInvoicePeriods();
    expect(periods.length).toBe(1);
    expect(periods[0].totalHours).toBe(2); // ancient-history + recent-history, not this-week

    const ancient = repo.listEntries({ userId: member.id }).find((e) => e.taskName === "AB1-ancient-history")!;
    const recent = repo.listEntries({ userId: member.id }).find((e) => e.taskName === "AB2-recent-history")!;
    const thisWeek = repo.listEntries({ userId: member.id }).find((e) => e.taskName === "AB3-this-week")!;
    expect(ancient.invoicePeriodId).toBe(created[0].id);
    expect(recent.invoicePeriodId).toBe(created[0].id);
    expect(thisWeek.invoicePeriodId).toBeNull();
  });

  it("is idempotent: a second call with the same now creates nothing new", () => {
    repo.createEntry({
      userId: member.id,
      task: "ab4-once",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    const now = new Date("2026-01-06T00:00:00.000Z");
    const first = invoices.createMissingPeriods(now);
    expect(first.length).toBe(1);

    const second = invoices.createMissingPeriods(now);
    expect(second.length).toBe(0);
    expect(invoices.listInvoicePeriods().length).toBe(1);

    // Entries keep their assignment; nothing gets reassigned or duplicated.
    const entry = repo.listEntries({ userId: member.id }).find((e) => e.taskName === "AB4-once")!;
    expect(entry.invoicePeriodId).toBe(first[0].id);
  });
});

describe("createMissingPeriods — incremental multi-week catch-up", () => {
  function seedExistingPeriod(): string {
    // Hand-insert one existing period (as if it were created weeks ago) so
    // the next createMissingPeriods() call takes the "incremental" branch
    // instead of bootstrap.
    const id = "period-jan04";
    db.prepare(
      "INSERT INTO invoice_periods (id, label, cutoff_at, locked, created_at) VALUES (?, ?, ?, 1, ?)"
    ).run(id, "2026-01-04", "2026-01-05T07:59:00.000Z", "2026-01-05T08:00:00.000Z");
    return id;
  }

  it("simulating 3 missed weeks creates exactly 3 periods with entries assigned by started_at", () => {
    seedExistingPeriod();

    // One entry per week: week of Jan5-11, Jan12-18, Jan19-25.
    repo.createEntry({
      userId: member.id,
      task: "ab5-week-one",
      startedAt: "2026-01-08T09:00:00.000Z",
      stoppedAt: "2026-01-08T10:00:00.000Z",
    });
    repo.createEntry({
      userId: member.id,
      task: "ab6-week-two",
      startedAt: "2026-01-15T09:00:00.000Z",
      stoppedAt: "2026-01-15T10:00:00.000Z",
    });
    repo.createEntry({
      userId: member.id,
      task: "ab7-week-three",
      startedAt: "2026-01-22T09:00:00.000Z",
      stoppedAt: "2026-01-22T10:00:00.000Z",
    });
    // Still within the current (4th) week — must remain unswept.
    repo.createEntry({
      userId: member.id,
      task: "ab8-current-week",
      startedAt: "2026-01-26T09:00:00.000Z",
      stoppedAt: "2026-01-26T10:00:00.000Z",
    });

    // now is after the Jan-25 cutoff but before the Feb-1 cutoff.
    const created = invoices.createMissingPeriods(new Date("2026-01-27T00:00:00.000Z"));
    expect(created.map((p) => p.label)).toEqual(["2026-01-11", "2026-01-18", "2026-01-25"]);

    const byTask = (name: string) => repo.listEntries({ userId: member.id }).find((e) => e.taskName === name)!;
    const weekOnePeriod = invoices.listInvoicePeriods().find((p) => p.label === "2026-01-11")!;
    const weekTwoPeriod = invoices.listInvoicePeriods().find((p) => p.label === "2026-01-18")!;
    const weekThreePeriod = invoices.listInvoicePeriods().find((p) => p.label === "2026-01-25")!;

    expect(byTask("AB5-week-one").invoicePeriodId).toBe(weekOnePeriod.id);
    expect(byTask("AB6-week-two").invoicePeriodId).toBe(weekTwoPeriod.id);
    expect(byTask("AB7-week-three").invoicePeriodId).toBe(weekThreePeriod.id);
    expect(byTask("AB8-current-week").invoicePeriodId).toBeNull();
  });

  it("a late-logged entry (backdated into an already-invoiced week) lands in the NEXT period created, not the one matching its date", () => {
    seedExistingPeriod();
    invoices.createMissingPeriods(new Date("2026-01-27T00:00:00.000Z")); // creates Jan-11/18/25 periods

    // Backdated into the Jan5-11 week, but logged only now — after that
    // period already closed. It must not vanish, and must not retroactively
    // land in the Jan-11 period either.
    const late = repo.createEntry({
      userId: member.id,
      task: "ab9-late-logged",
      startedAt: "2026-01-08T14:00:00.000Z",
      stoppedAt: "2026-01-08T15:00:00.000Z",
    });
    expect(late.invoicePeriodId).toBeNull();

    // Not yet past the next (Feb-1) cutoff — still unswept.
    invoices.createMissingPeriods(new Date("2026-01-28T00:00:00.000Z"));
    expect(repo.getEntry(late.id)!.invoicePeriodId).toBeNull();

    // Now past the Feb-1 cutoff (2026-02-02T07:59:00.000Z PST): the late
    // entry sweeps into THAT period.
    const created = invoices.createMissingPeriods(new Date("2026-02-03T00:00:00.000Z"));
    const febPeriod = created.find((p) => p.label === "2026-02-01")!;
    expect(febPeriod).toBeTruthy();
    expect(repo.getEntry(late.id)!.invoicePeriodId).toBe(febPeriod.id);

    const jan11Period = invoices.listInvoicePeriods().find((p) => p.label === "2026-01-11")!;
    expect(repo.getEntry(late.id)!.invoicePeriodId).not.toBe(jan11Period.id);
  });

  it("a running entry at cutoff time is excluded, then swept once stopped", () => {
    seedExistingPeriod();

    const running = repo.startTimer({ userId: member.id, task: "ab10-still-running" });
    // Backdate its startedAt into the Jan5-11 week directly in the DB (the
    // timer API always starts "now", so we adjust the raw row to simulate a
    // timer that's been running since early in that week).
    db.prepare("UPDATE time_entries SET started_at = ? WHERE id = ?").run(
      "2026-01-08T09:00:00.000Z",
      running.id
    );

    invoices.createMissingPeriods(new Date("2026-01-13T00:00:00.000Z")); // past the Jan-11 cutoff
    expect(repo.getEntry(running.id)!.invoicePeriodId).toBeNull(); // still running — excluded

    repo.stopTimer({ userId: member.id });
    // Still not past the next cutoff yet — remains unswept immediately after stopping.
    expect(repo.getEntry(running.id)!.invoicePeriodId).toBeNull();

    const created = invoices.createMissingPeriods(new Date("2026-01-20T00:00:00.000Z")); // past Jan-18 cutoff
    const jan18Period = created.find((p) => p.label === "2026-01-18")!;
    expect(repo.getEntry(running.id)!.invoicePeriodId).toBe(jan18Period.id);
  });
});

describe("locking — updateEntry/deleteEntry/setTimesheetCell", () => {
  function seedLockedEntry(): { entryId: string; periodId: string } {
    const entry = repo.createEntry({
      userId: member.id,
      task: "ab11-invoiced-task",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    const created = invoices.createMissingPeriods(new Date("2026-01-06T00:00:00.000Z"));
    const period = created[0];
    expect(period).toBeTruthy();
    expect(period.locked).toBe(true);
    return { entryId: entry.id, periodId: period.id };
  }

  it("403s a member editing a locked entry; admin succeeds", () => {
    const { entryId } = seedLockedEntry();
    expectApiError(
      () => repo.updateEntry(entryId, { task: "ab11-renamed" }, { id: member.id, role: "member" }),
      403,
      "already invoiced"
    );
    const updated = repo.updateEntry(entryId, { task: "ab11-renamed" }, { id: admin.id, role: "admin" });
    expect(updated.taskName).toBe("AB11-renamed");
  });

  it("403s a member deleting a locked entry; admin succeeds", () => {
    const { entryId } = seedLockedEntry();
    expectApiError(
      () => repo.deleteEntry(entryId, { id: member.id, role: "member" }),
      403,
      "already invoiced"
    );
    expect(() => repo.deleteEntry(entryId, { id: admin.id, role: "admin" })).not.toThrow();
    expect(repo.getEntry(entryId)).toBeNull();
  });

  it("leaves the lock check off entirely when actingUser is omitted (internal/trusted callers)", () => {
    const { entryId } = seedLockedEntry();
    expect(() => repo.updateEntry(entryId, { task: "ab11-untouched-check" })).not.toThrow();
  });

  it("403s a member's setTimesheetCell touching a locked entry; admin succeeds", () => {
    seedLockedEntry();
    expectApiError(
      () =>
        repo.setTimesheetCell({
          userId: member.id,
          task: "ab11-invoiced-task",
          date: "2026-01-01",
          hours: 5,
          actingUser: { id: member.id, role: "member" },
        }),
      403,
      "already invoiced"
    );
    // The cell must be untouched by the failed attempt — original entry still there, unmodified.
    const stillThere = repo
      .listEntries({ userId: member.id })
      .find((e) => e.taskName === "AB11-invoiced-task")!;
    expect(stillThere.durationSecs).toBe(3600);

    const result = repo.setTimesheetCell({
      userId: member.id,
      task: "ab11-invoiced-task",
      date: "2026-01-01",
      hours: 5,
      actingUser: { id: admin.id, role: "admin" },
    });
    expect(result.hours).toBe(5);
  });

  it("unlock lets a member edit; relock 403s again", () => {
    const { entryId, periodId } = seedLockedEntry();

    invoices.setInvoicePeriodLocked(periodId, false);
    const updated = repo.updateEntry(entryId, { task: "ab11-edited-while-unlocked" }, { id: member.id, role: "member" });
    expect(updated.taskName).toBe("AB11-edited-while-unlocked");

    invoices.setInvoicePeriodLocked(periodId, true);
    expectApiError(
      () => repo.updateEntry(entryId, { task: "ab11-should-fail" }, { id: member.id, role: "member" }),
      403,
      "already invoiced"
    );
  });

  it("unlocking does NOT detach entries — a re-run of createMissingPeriods after unlock doesn't re-sweep or double-bill", () => {
    const { entryId, periodId } = seedLockedEntry();
    invoices.setInvoicePeriodLocked(periodId, false);

    expect(repo.getEntry(entryId)!.invoicePeriodId).toBe(periodId);

    const before = invoices.listInvoicePeriods().length;
    const created = invoices.createMissingPeriods(new Date("2026-01-06T00:00:00.000Z"));
    expect(created.length).toBe(0); // no re-sweep, no new period
    expect(invoices.listInvoicePeriods().length).toBe(before);
    expect(repo.getEntry(entryId)!.invoicePeriodId).toBe(periodId); // still attached, unchanged
  });
});

describe("currentUninvoiced", () => {
  it("totals completed uninvoiced entries per member and reports the next cutoff", () => {
    repo.createEntry({
      userId: member.id,
      task: "ab12-uninvoiced-a",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T11:00:00.000Z", // 2h
    });
    repo.createEntry({
      userId: admin.id,
      task: "ab13-uninvoiced-b",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T09:30:00.000Z", // 0.5h
    });
    // A running entry must never count toward the preview.
    repo.startTimer({ userId: member.id, task: "ab14-running-excluded" });

    const now = new Date("2026-01-03T00:00:00.000Z");
    const result = invoices.currentUninvoiced(now);
    expect(result.totalHours).toBe(2.5);
    const memberRow = result.members.find((m) => m.id === member.id)!;
    const adminRow = result.members.find((m) => m.id === admin.id)!;
    expect(memberRow.hours).toBe(2);
    expect(adminRow.hours).toBe(0.5);
    // Next cutoff after Jan 3 (a Saturday) is the Jan-4 Sunday cutoff.
    expect(result.nextCutoffAt).toBe("2026-01-05T07:59:00.000Z");
  });

  it("excludes entries already swept into a period", () => {
    repo.createEntry({
      userId: member.id,
      task: "ab15-already-invoiced",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });
    invoices.createMissingPeriods(new Date("2026-01-06T00:00:00.000Z"));

    const result = invoices.currentUninvoiced(new Date("2026-01-06T00:00:00.000Z"));
    expect(result.totalHours).toBe(0);
    expect(result.members.length).toBe(0);
  });
});

describe("invoicePeriodDetail and listInvoicePeriods", () => {
  it("aggregates per-member totals and per-member/per-task detail rows", () => {
    repo.createEntry({
      userId: member.id,
      task: "ab16-detail-task-one",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z", // 1h
    });
    repo.createEntry({
      userId: member.id,
      task: "ab17-detail-task-two",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T11:00:00.000Z", // 2h
    });
    repo.createEntry({
      userId: admin.id,
      task: "ab16-detail-task-one",
      startedAt: "2026-01-02T09:00:00.000Z",
      stoppedAt: "2026-01-02T09:30:00.000Z", // 0.5h
    });

    const created = invoices.createMissingPeriods(new Date("2026-01-06T00:00:00.000Z"));
    const period = created[0];

    const summary = invoices.listInvoicePeriods().find((p) => p.id === period.id)!;
    expect(summary.totalHours).toBe(3.5);
    expect(summary.memberCount).toBe(2);

    const detail = invoices.invoicePeriodDetail(period.id);
    const memberSummary = detail.members.find((m) => m.id === member.id)!;
    expect(memberSummary.hours).toBe(3);
    const adminSummary = detail.members.find((m) => m.id === admin.id)!;
    expect(adminSummary.hours).toBe(0.5);

    expect(detail.taskDetail).toEqual(
      expect.arrayContaining([
        { member: "Alice", task: "AB16-detail-task-one", hours: 1 },
        { member: "Alice", task: "AB17-detail-task-two", hours: 2 },
        { member: "Drew", task: "AB16-detail-task-one", hours: 0.5 },
      ])
    );
  });

  it("404s invoicePeriodDetail for an unknown id", () => {
    expectApiError(() => invoices.invoicePeriodDetail("nope"), 404);
  });

  it("404s setInvoicePeriodLocked for an unknown id", () => {
    expectApiError(() => invoices.setInvoicePeriodLocked("nope", true), 404);
  });
});

describe("API routes — /api/invoices (admin only)", () => {
  let adminToken: string;
  let memberToken: string;
  let periodId: string;

  beforeEach(() => {
    adminToken = auth.createSession(admin.id).token;
    memberToken = auth.createSession(member.id).token;
    repo.createEntry({
      userId: member.id,
      task: "ab18-route-task",
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T11:30:00.000Z", // 2.5h
    });
    const created = invoices.createMissingPeriods(new Date("2026-01-06T00:00:00.000Z"));
    periodId = created[0].id;
  });

  it("GET /api/invoices 403s a member and 200s an admin with periods + current", async () => {
    const memberRes = await invoicesRoute.GET(req("/api/invoices", { token: memberToken }));
    expect(memberRes.status).toBe(403);

    const adminRes = await invoicesRoute.GET(req("/api/invoices", { token: adminToken }));
    expect(adminRes.status).toBe(200);
    const json = await adminRes.json();
    expect(json.data.periods.length).toBe(1);
    expect(json.data.periods[0].totalHours).toBe(2.5);
    expect(json.data.current).toBeTruthy();
  });

  it("GET /api/invoices/[id] 403s a member and 200s an admin with member+task detail", async () => {
    const memberRes = await invoiceByIdRoute.GET(req(`/api/invoices/${periodId}`, { token: memberToken }), {
      params: Promise.resolve({ id: periodId }),
    });
    expect(memberRes.status).toBe(403);

    const adminRes = await invoiceByIdRoute.GET(req(`/api/invoices/${periodId}`, { token: adminToken }), {
      params: Promise.resolve({ id: periodId }),
    });
    expect(adminRes.status).toBe(200);
    const json = await adminRes.json();
    expect(json.data.members[0].hours).toBe(2.5);
    expect(json.data.taskDetail[0]).toEqual({ member: "Alice", task: "AB18-route-task", hours: 2.5 });
  });

  it("PATCH /api/invoices/[id] {locked} 403s a member and 200s an admin", async () => {
    const memberRes = await invoiceByIdRoute.PATCH(
      req(`/api/invoices/${periodId}`, { method: "PATCH", token: memberToken, body: { locked: false } }),
      { params: Promise.resolve({ id: periodId }) }
    );
    expect(memberRes.status).toBe(403);

    const adminRes = await invoiceByIdRoute.PATCH(
      req(`/api/invoices/${periodId}`, { method: "PATCH", token: adminToken, body: { locked: false } }),
      { params: Promise.resolve({ id: periodId }) }
    );
    expect(adminRes.status).toBe(200);
    const json = await adminRes.json();
    expect(json.data.locked).toBe(false);
  });

  it("GET /api/invoices/[id]/csv 403s a member; admin gets engineer,bill_rate,hours with empty bill_rate and the right filename", async () => {
    const memberRes = await invoiceCsvRoute.GET(req(`/api/invoices/${periodId}/csv`, { token: memberToken }), {
      params: Promise.resolve({ id: periodId }),
    });
    expect(memberRes.status).toBe(403);

    const adminRes = await invoiceCsvRoute.GET(req(`/api/invoices/${periodId}/csv`, { token: adminToken }), {
      params: Promise.resolve({ id: periodId }),
    });
    expect(adminRes.status).toBe(200);
    expect(adminRes.headers.get("content-type")).toContain("text/csv");
    expect(adminRes.headers.get("content-disposition")).toContain('filename="invoice_2026-01-04.csv"');
    const text = await adminRes.text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("engineer,bill_rate,hours");
    expect(lines[1]).toBe("Alice,,2.5");
  });
});
