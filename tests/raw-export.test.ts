// Reconciliation columns on the reports CSV (v3.12). The original eight
// columns must stay in place — people have spreadsheet formulas pointing at
// them — and the new ones must carry the immovable values: entry id, task
// id, raw UTC timestamps, and the invoice the row was billed on.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-rawexport-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;

const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const auth = await import("../src/lib/auth");
const invoices = await import("../src/lib/invoices");
const csvRoute = await import("../src/app/api/reports/csv/route");

function resetDb() {
  db.exec(
    "DELETE FROM time_entries; DELETE FROM invoice_periods; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;"
  );
}
function req(url: string, token: string) {
  return new NextRequest(new URL(url, "http://localhost"), {
    headers: { cookie: `${auth.SESSION_COOKIE}=${token}` },
  });
}
function parseCsv(text: string): string[][] {
  return text.trim().split("\n").map((l) => l.split(","));
}

let adminToken: string;
let member: ReturnType<typeof repo.createUser>;
let entry: ReturnType<typeof repo.createEntry>;

beforeEach(() => {
  resetDb();
  const admin = repo.createUser({ name: "Drew", email: "admin@reposcout.dev", password: "opentime-dev", role: "admin" });
  member = repo.createUser({ name: "Aditya", email: "aditya@example.com", password: "password123", role: "member" });
  adminToken = auth.createSession(admin.id).token;
  // 09:00 IST on Aug 2 — the shape a timesheet submission from India takes.
  entry = repo.createEntry({
    userId: member.id,
    task: "Task 20",
    startedAt: "2026-08-02T03:30:00.000Z",
    stoppedAt: "2026-08-02T16:30:00.000Z",
  });
});

afterAll(() => {
  db.close();
  for (const f of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

describe("reports CSV reconciliation columns", () => {
  it("keeps the original eight columns first, in order", async () => {
    const res = await csvRoute.GET(req("http://localhost/api/reports/csv?userId=all", adminToken));
    const [header] = parseCsv(await res.text());
    expect(header.slice(0, 8)).toEqual([
      "member", "project", "task", "task_status", "task_link", "task_details", "duration_hours", "date",
    ]);
    expect(header.slice(8)).toEqual([
      "entry_id", "task_id", "started_at_utc", "stopped_at_utc", "invoice_period", "invoice_locked",
    ]);
  });

  it("emits the entry id, task id, and raw UTC timestamps", async () => {
    const res = await csvRoute.GET(req("http://localhost/api/reports/csv?userId=all", adminToken));
    const [, row] = parseCsv(await res.text());
    expect(row[8]).toBe(entry.id);
    expect(row[9]).toBe(entry.taskId);
    expect(row[10]).toBe("2026-08-02T03:30:00.000Z");
    expect(row[11]).toBe("2026-08-02T16:30:00.000Z");
    expect(row[12]).toBe(""); // not yet invoiced
    expect(row[13]).toBe("false");
  });

  it("the UTC columns are identical no matter which timezone downloads it", async () => {
    const ist = parseCsv(await (await csvRoute.GET(req("http://localhost/api/reports/csv?userId=all&tz=Asia/Kolkata", adminToken))).text())[1];
    const ct = parseCsv(await (await csvRoute.GET(req("http://localhost/api/reports/csv?userId=all&tz=America/Chicago", adminToken))).text())[1];
    // The bug: the date column disagrees by a day.
    expect(ist[7]).toBe("2026-08-02");
    expect(ct[7]).toBe("2026-08-01");
    // The fix: everything that identifies the row agrees.
    expect(ist.slice(8)).toEqual(ct.slice(8));
  });

  it("names the week-ending invoice period once the row is swept and locked", async () => {
    invoices.createMissingPeriods(new Date("2026-09-01T00:00:00.000Z"));
    const period = invoices.listInvoicePeriods().find((p) => p.totalHours > 0)!;
    invoices.setInvoicePeriodLocked(period.id, true);

    const res = await csvRoute.GET(req("http://localhost/api/reports/csv?userId=all", adminToken));
    const [, row] = parseCsv(await res.text());
    expect(row[12]).toBe(period.label);
    expect(row[13]).toBe("true");
  });

  it("with no from/to returns every entry, including a removed member's", async () => {
    const admin = repo.getUserAuthByEmail("admin@reposcout.dev")!;
    repo.removeUser(member.id, admin.id);
    const res = await csvRoute.GET(req("http://localhost/api/reports/csv?userId=all", adminToken));
    const rows = parseCsv(await res.text());
    expect(rows).toHaveLength(2); // header + Aditya's row
    expect(rows[1][0]).toBe("Aditya");
    expect(res.headers.get("Content-Disposition")).toContain("opentime_all_all.csv");
  });
});
