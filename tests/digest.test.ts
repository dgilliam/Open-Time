// Daily digest builder/renderer (v3.9 prototype) — nothing here sends
// anything; these pin the aggregation (zone-aware day, per-member/task
// grouping, no-hours list) and the exact Slack text.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-digest-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;

const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const digest = await import("../src/lib/digest");

let admin: ReturnType<typeof repo.createUser>;
let ada: ReturnType<typeof repo.createUser>;
let grace: ReturnType<typeof repo.createUser>;

beforeEach(() => {
  db.exec("DELETE FROM time_entries; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;");
  admin = repo.createUser({ name: "Drew", email: "admin@reposcout.dev", password: "opentime-dev", role: "admin" });
  ada = repo.createUser({ name: "Ada", email: "ada@reposcout.dev", password: "password123", role: "member" });
  grace = repo.createUser({ name: "Grace", email: "grace@reposcout.dev", password: "password123", role: "member" });
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpDbPath, { force: true });
});

describe("buildDailyDigest", () => {
  it("groups a viewer-zone day per member and task, hours desc, with a no-hours list", () => {
    // 9:30 PM Jul 17 Chicago = 02:30 UTC Jul 18 — belongs to Jul 17 for a Chicago viewer.
    repo.createEntry({
      userId: ada.id,
      task: "eval harness",
      startedAt: "2026-07-18T02:30:00.000Z",
      stoppedAt: "2026-07-18T04:00:00.000Z",
    });
    repo.createEntry({
      userId: ada.id,
      task: "eval harness",
      startedAt: "2026-07-17T15:00:00.000Z",
      stoppedAt: "2026-07-17T16:00:00.000Z",
    });
    repo.createEntry({
      userId: ada.id,
      task: "standup",
      startedAt: "2026-07-17T17:00:00.000Z",
      stoppedAt: "2026-07-17T17:30:00.000Z",
    });
    // Different day — excluded.
    repo.createEntry({
      userId: grace.id,
      task: "eval harness",
      startedAt: "2026-07-16T15:00:00.000Z",
      stoppedAt: "2026-07-16T16:00:00.000Z",
    });

    const d = digest.buildDailyDigest("2026-07-17", "America/Chicago");
    expect(d.members).toHaveLength(1);
    expect(d.members[0].name).toBe("Ada");
    expect(d.members[0].hours).toBe(3);
    expect(d.members[0].tasks).toEqual([
      { task: "eval harness", hours: 2.5 },
      { task: "standup", hours: 0.5 },
    ]);
    expect(d.totalHours).toBe(3);
    // Grace logged nothing THAT day; the admin is never listed.
    expect(d.noHours).toEqual(["Grace"]);
  });

  it("excludes running entries and removed members", () => {
    repo.startTimer({ userId: ada.id, task: "still running" });
    repo.removeUser(grace.id, admin.id);
    const today = new Date().toISOString().slice(0, 10);
    const d = digest.buildDailyDigest(today, "UTC");
    expect(d.members).toHaveLength(0);
    // ada has no completed hours; removed grace is not resurrected into the list.
    expect(d.noHours).toEqual(["Ada"]);
  });
});

describe("renderDigestSlackText", () => {
  it("renders the exact mrkdwn contract", () => {
    repo.createEntry({
      userId: ada.id,
      task: "eval harness",
      startedAt: "2026-07-17T15:00:00.000Z",
      stoppedAt: "2026-07-17T17:30:00.000Z",
    });
    const d = digest.buildDailyDigest("2026-07-17", "UTC");
    const text = digest.renderDigestSlackText(d);
    expect(text).toContain(":clock3: *Open-Time — Friday, Jul 17*");
    expect(text).toContain("*1 logged · 2.5h total*");
    // Table lives in a code block (Slack's only monospace/aligned context).
    expect(text).toContain("```");
    expect(text).toContain("Member  Hours");
    expect(text).toContain("Ada      2.5h");
    expect(text).toContain("Total    2.5h");
    // Task lines don't repeat the member total — the table already has it.
    expect(text).toContain("• *Ada* — `eval harness` 2.5h");
    expect(text).toContain("_No hours: Grace_");

    // Table-only variant drops the bullets but keeps table + footer.
    const tableOnly = digest.renderDigestSlackText(d, { tasks: false });
    expect(tableOnly).toContain("Ada      2.5h");
    expect(tableOnly).not.toContain("• *Ada*");
    expect(tableOnly).toContain("_No hours: Grace_");
  });

  it("ellipsizes very long free-text task names", () => {
    const long = "Claude Code (Opus/max): repo orientation and money movement surface mapping deep dive";
    repo.createEntry({
      userId: ada.id,
      task: long,
      startedAt: "2026-07-17T15:00:00.000Z",
      stoppedAt: "2026-07-17T16:00:00.000Z",
    });
    const text = digest.renderDigestSlackText(digest.buildDailyDigest("2026-07-17", "UTC"));
    expect(text).toContain("…");
    expect(text).not.toContain(long);
  });

  it("renders a quiet day as a one-liner", () => {
    const text = digest.renderDigestSlackText(digest.buildDailyDigest("2026-07-17", "UTC"));
    expect(text).toContain("_No hours logged._");
  });
});
