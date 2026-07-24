// "Sign in with Google" (v3.6) route tests. Google's token + userinfo
// endpoints are stubbed with a local http server (the URLs are
// env-overridable in src/lib/google.ts), so these exercise the real route
// handlers end to end: state/PKCE cookie checks, member matching, session
// minting, and every refusal path.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";

const tmpDbPath = path.join(os.tmpdir(), `opentime-test-google-${process.pid}-${Date.now()}.db`);
process.env.OPENTIME_DB = tmpDbPath;
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_AUTH_URL = "https://stub.example/auth"; // never fetched — only redirected to

// Stub token + userinfo server; each test sets `stub` before hitting the callback.
let stub: {
  tokenStatus?: number;
  email?: string;
  emailVerified?: boolean;
} = {};

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/token")) {
    res.writeHead(stub.tokenStatus ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ access_token: "stub-access-token" }));
    return;
  }
  if (req.url?.startsWith("/userinfo")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ email: stub.email, email_verified: stub.emailVerified }));
    return;
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(0, resolve));
const stubPort = (server.address() as { port: number }).port;
process.env.GOOGLE_TOKEN_URL = `http://127.0.0.1:${stubPort}/token`;
process.env.GOOGLE_USERINFO_URL = `http://127.0.0.1:${stubPort}/userinfo`;

const { db } = await import("../src/lib/db");
const repo = await import("../src/lib/repo");
const auth = await import("../src/lib/auth");
const startRoute = await import("../src/app/api/auth/google/route");
const callbackRoute = await import("../src/app/api/auth/google/callback/route");
const providersRoute = await import("../src/app/api/auth/providers/route");

function resetDb() {
  db.exec("DELETE FROM time_entries; DELETE FROM tasks; DELETE FROM sessions; DELETE FROM users;");
}

let member: ReturnType<typeof repo.createUser>;

beforeEach(() => {
  resetDb();
  stub = {};
  member = repo.createUser({
    name: "Grace",
    email: "grace@reposcout.dev",
    password: "password123",
    role: "member",
  });
});

afterAll(() => {
  server.close();
  db.close();
  fs.rmSync(tmpDbPath, { force: true });
});

function callbackReq(opts: {
  code?: string;
  state?: string;
  cookieState?: string;
  verifier?: string;
  error?: string;
}) {
  const url = new URL("http://localhost/api/auth/google/callback");
  if (opts.code) url.searchParams.set("code", opts.code);
  if (opts.state) url.searchParams.set("state", opts.state);
  if (opts.error) url.searchParams.set("error", opts.error);
  const cookies: string[] = [];
  if (opts.cookieState) cookies.push(`ot_google_state=${opts.cookieState}`);
  if (opts.verifier) cookies.push(`ot_google_verifier=${opts.verifier}`);
  return new NextRequest(url, { headers: cookies.length ? { cookie: cookies.join("; ") } : {} });
}

function location(res: Response): string {
  return res.headers.get("location") ?? "";
}

function sessionTokenFrom(res: Response): string | null {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const sess = setCookies.find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`) && !c.includes("Max-Age=0"));
  return sess ? sess.split(";")[0].split("=")[1] : null;
}

describe("GET /api/auth/google (start)", () => {
  it("redirects to Google with state + PKCE and sets matching cookies", async () => {
    const res = await startRoute.GET(new NextRequest("http://localhost/api/auth/google"));
    expect([302, 307]).toContain(res.status);
    const target = new URL(location(res));
    expect(`${target.origin}${target.pathname}`).toBe("https://stub.example/auth");
    expect(target.searchParams.get("client_id")).toBe("test-client-id");
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("redirect_uri")).toBe("http://localhost/api/auth/google/callback");

    const cookies = res.headers.getSetCookie();
    const stateCookie = cookies.find((c) => c.startsWith("ot_google_state="))!;
    expect(stateCookie.split(";")[0].split("=")[1]).toBe(target.searchParams.get("state"));
    expect(cookies.some((c) => c.startsWith("ot_google_verifier="))).toBe(true);
  });

  it("derives the public redirect_uri from x-forwarded-* behind a proxy (v3.6.1)", async () => {
    // Railway terminates TLS and forwards to the app's internal origin —
    // the redirect_uri sent to Google must be the PUBLIC host, not that.
    const res = await startRoute.GET(
      new NextRequest("https://localhost:8080/api/auth/google", {
        headers: { "x-forwarded-host": "time.reposcout.com", "x-forwarded-proto": "https" },
      })
    );
    const target = new URL(location(res));
    expect(target.searchParams.get("redirect_uri")).toBe(
      "https://time.reposcout.com/api/auth/google/callback"
    );
  });

  it("OPENTIME_BASE_URL overrides everything", async () => {
    process.env.OPENTIME_BASE_URL = "https://override.example";
    try {
      const res = await startRoute.GET(
        new NextRequest("https://localhost:8080/api/auth/google", {
          headers: { "x-forwarded-host": "time.reposcout.com", "x-forwarded-proto": "https" },
        })
      );
      const target = new URL(location(res));
      expect(target.searchParams.get("redirect_uri")).toBe(
        "https://override.example/api/auth/google/callback"
      );
    } finally {
      delete process.env.OPENTIME_BASE_URL;
    }
  });
});

describe("GET /api/auth/google/callback", () => {
  it("signs in a member whose verified Google email matches (case-insensitively)", async () => {
    stub = { email: "Grace@RepoScout.dev", emailVerified: true };
    const res = await callbackRoute.GET(
      callbackReq({ code: "c1", state: "s1", cookieState: "s1", verifier: "v1" })
    );
    // No proxy headers in this request, so base falls back to the request origin.
    expect(location(res)).toBe("http://localhost/");
    const token = sessionTokenFrom(res);
    expect(token).toBeTruthy();
    expect(auth.getSessionUser(token)?.id).toBe(member.id);
  });

  it("refuses an email that isn't a member, with no session", async () => {
    stub = { email: "stranger@example.com", emailVerified: true };
    const res = await callbackRoute.GET(
      callbackReq({ code: "c1", state: "s1", cookieState: "s1", verifier: "v1" })
    );
    expect(location(res)).toContain("/login?error=not_member");
    expect(sessionTokenFrom(res)).toBeNull();
  });

  it("refuses an unverified email", async () => {
    stub = { email: "grace@reposcout.dev", emailVerified: false };
    const res = await callbackRoute.GET(
      callbackReq({ code: "c1", state: "s1", cookieState: "s1", verifier: "v1" })
    );
    expect(location(res)).toContain("/login?error=google_failed");
    expect(sessionTokenFrom(res)).toBeNull();
  });

  it("refuses a removed member", async () => {
    const admin = repo.createUser({
      name: "Admin",
      email: "admin@reposcout.dev",
      password: "opentime-dev",
      role: "admin",
    });
    repo.removeUser(member.id, admin.id);
    stub = { email: "grace@reposcout.dev", emailVerified: true };
    const res = await callbackRoute.GET(
      callbackReq({ code: "c1", state: "s1", cookieState: "s1", verifier: "v1" })
    );
    expect(location(res)).toContain("/login?error=not_member");
    expect(sessionTokenFrom(res)).toBeNull();
  });

  it("refuses a state mismatch (CSRF) and a missing state cookie", async () => {
    stub = { email: "grace@reposcout.dev", emailVerified: true };
    const mismatch = await callbackRoute.GET(
      callbackReq({ code: "c1", state: "attacker", cookieState: "s1", verifier: "v1" })
    );
    expect(location(mismatch)).toContain("/login?error=google_failed");

    const missing = await callbackRoute.GET(callbackReq({ code: "c1", state: "s1", verifier: "v1" }));
    expect(location(missing)).toContain("/login?error=google_failed");
    expect(sessionTokenFrom(missing)).toBeNull();
  });

  it("maps a user-cancelled consent to its own error code", async () => {
    const res = await callbackRoute.GET(callbackReq({ error: "access_denied" }));
    expect(location(res)).toContain("/login?error=google_cancelled");
  });

  it("turns a token-exchange failure into the generic error, with no session", async () => {
    stub = { tokenStatus: 500, email: "grace@reposcout.dev", emailVerified: true };
    const res = await callbackRoute.GET(
      callbackReq({ code: "c1", state: "s1", cookieState: "s1", verifier: "v1" })
    );
    expect(location(res)).toContain("/login?error=google_failed");
    expect(sessionTokenFrom(res)).toBeNull();
  });
});

describe("GET /api/auth/providers", () => {
  it("reports google availability from env", async () => {
    const res = await providersRoute.GET();
    const json = await res.json();
    expect(json.data).toEqual({ google: true });
  });
});
