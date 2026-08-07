// Digest delivery (v3.9): Slack's chat.postMessage is stubbed with a local
// http server (SLACK_API_URL is env-overridable), so these exercise the real
// send path — idempotency via notifications_log, quiet-day skipping, forced
// re-sends, transient-failure retry, and the scheduler's send-hour gate.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-digest-send-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;
process.env.SLACK_BOT_TOKEN = "xoxb-test";
process.env.SLACK_DIGEST_CHANNEL = "#time-tracking";
process.env.OPENTIME_TZ = "America/Chicago";

/** Posts captured by the stub, plus a switch to simulate Slack failures. */
const posted: { channel: string; text: string }[] = [];
let slackOk = true;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url?.endsWith("/chat.postMessage")) {
      const parsed = JSON.parse(body || "{}");
      if (slackOk) posted.push({ channel: parsed.channel, text: parsed.text });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(slackOk ? { ok: true } : { ok: false, error: "channel_not_found" }));
      return;
    }
    res.writeHead(404).end();
  });
});
await new Promise<void>((resolve) => server.listen(0, resolve));
process.env.SLACK_API_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const digest = await import("../src/lib/digest");

let ada: ReturnType<typeof repo.createUser>;

beforeEach(() => {
  db.exec(
    "DELETE FROM time_entries; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users; DELETE FROM notifications_log;"
  );
  posted.length = 0;
  slackOk = true;
  repo.createUser({ name: "Drew", email: "admin@reposcout.dev", password: "opentime-dev", role: "admin" });
  ada = repo.createUser({ name: "Ada", email: "ada@reposcout.dev", password: "password123", role: "member" });
});

afterAll(() => {
  server.close();
  db.close();
  fs.rmSync(tmpDbPath, { force: true });
});

/** 10:00–12:30 Chicago on Jul 17 2026 (CDT, UTC-5). */
function seedHours() {
  repo.createEntry({
    userId: ada.id,
    task: "eval harness",
    startedAt: "2026-07-17T15:00:00.000Z",
    stoppedAt: "2026-07-17T17:30:00.000Z",
  });
}

describe("sendDailyDigest", () => {
  it("posts the rendered digest to the configured channel and records it", async () => {
    seedHours();
    const result = await digest.sendDailyDigest("2026-07-17");
    expect(result.status).toBe("sent");
    expect(posted).toHaveLength(1);
    expect(posted[0].channel).toBe("#time-tracking");
    expect(posted[0].text).toContain("Ada");
    expect(posted[0].text).toContain("2.5h");
    expect(
      db.prepare("SELECT 1 FROM notifications_log WHERE kind='daily_digest' AND key='2026-07-17'").get()
    ).toBeTruthy();
  });

  it("never posts the same day twice", async () => {
    seedHours();
    await digest.sendDailyDigest("2026-07-17");
    const second = await digest.sendDailyDigest("2026-07-17");
    expect(second.status).toBe("skipped");
    expect(second.reason).toBe("already sent");
    expect(posted).toHaveLength(1);
  });

  it("skips a quiet day without posting, and doesn't re-evaluate it later", async () => {
    const result = await digest.sendDailyDigest("2026-07-17");
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no hours logged");
    expect(posted).toHaveLength(0);
    const again = await digest.sendDailyDigest("2026-07-17");
    expect(again.reason).toBe("already sent");
  });

  it("force re-posts an already-sent day (the admin's Send now button)", async () => {
    seedHours();
    await digest.sendDailyDigest("2026-07-17");
    const forced = await digest.sendDailyDigest("2026-07-17", { force: true });
    expect(forced.status).toBe("sent");
    expect(posted).toHaveLength(2);
  });

  it("releases its claim when Slack fails, so the next tick retries", async () => {
    seedHours();
    slackOk = false;
    const failed = await digest.sendDailyDigest("2026-07-17");
    expect(failed.status).toBe("failed");
    expect(failed.reason).toBe("channel_not_found");
    expect(
      db.prepare("SELECT 1 FROM notifications_log WHERE kind='daily_digest' AND key='2026-07-17'").get()
    ).toBeFalsy();

    slackOk = true;
    const retry = await digest.sendDailyDigest("2026-07-17");
    expect(retry.status).toBe("sent");
    expect(posted).toHaveLength(1);
  });
});

describe("runScheduledDigest", () => {
  it("waits for the configured local send hour", async () => {
    seedHours();
    // 12:00 UTC Jul 18 = 07:00 Chicago — before the default 09:00 send hour.
    const early = await digest.runScheduledDigest(new Date("2026-07-18T12:00:00.000Z"));
    expect(early.status).toBe("skipped");
    expect(early.reason).toBe("before send hour");
    expect(posted).toHaveLength(0);

    // 15:00 UTC = 10:00 Chicago — past it, so yesterday's digest goes out.
    const onTime = await digest.runScheduledDigest(new Date("2026-07-18T15:00:00.000Z"));
    expect(onTime.status).toBe("sent");
    expect(onTime.date).toBe("2026-07-17");
    expect(posted).toHaveLength(1);
  });

  it("is safe to run hourly — only the first tick past the hour posts", async () => {
    seedHours();
    await digest.runScheduledDigest(new Date("2026-07-18T15:00:00.000Z"));
    await digest.runScheduledDigest(new Date("2026-07-18T16:00:00.000Z"));
    await digest.runScheduledDigest(new Date("2026-07-18T17:00:00.000Z"));
    expect(posted).toHaveLength(1);
  });

  it("targets the previous day in the configured timezone", () => {
    // 03:00 UTC Jul 18 is still Jul 17 in Chicago → yesterday is Jul 16.
    expect(digest.digestTargetDate(new Date("2026-07-18T03:00:00.000Z"), "America/Chicago")).toBe(
      "2026-07-16"
    );
    // 15:00 UTC Jul 18 is Jul 18 in Chicago → yesterday is Jul 17.
    expect(digest.digestTargetDate(new Date("2026-07-18T15:00:00.000Z"), "America/Chicago")).toBe(
      "2026-07-17"
    );
  });
});
