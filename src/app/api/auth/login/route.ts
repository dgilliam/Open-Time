import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie, verifyLoginPassword } from "@/lib/auth";
import {
  EMAIL_LIMIT,
  IP_LIMIT,
  checkRateLimit,
  clientIp,
  recordFailure,
  recordSuccess,
} from "@/lib/ratelimit";
import { getUserAuthByEmail } from "@/lib/repo";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "");
    if (!email || !password) throw new ApiError(400, "email and password are required");

    // Throttling (security review 2026-08-15): unlimited guesses against an
    // 8-character minimum was the most realistic way into this app. Both
    // buckets must allow the attempt; see src/lib/ratelimit.ts.
    const emailKey = `email:${email.toLowerCase()}`;
    const ipKey = `ip:${clientIp(req)}`;
    const verdict = [checkRateLimit(emailKey), checkRateLimit(ipKey)]
      .filter((v) => !v.allowed)
      .sort((a, b) => b.retryAfterSecs - a.retryAfterSecs)[0];
    if (verdict) {
      // 429 rather than 401: the attempt was never evaluated, and saying so
      // leaks nothing a rate limiter doesn't inherently announce.
      const res = NextResponse.json(
        { error: "too many sign-in attempts — wait a moment and try again" },
        { status: 429 }
      );
      res.headers.set("Retry-After", String(verdict.retryAfterSecs));
      return res;
    }

    const userAuth = getUserAuthByEmail(email);
    // Always pays for a scrypt derivation, even on an unknown email, so the
    // response time can't be used to enumerate members.
    if (!verifyLoginPassword(password, userAuth?.passwordHash ?? null)) {
      recordFailure(emailKey, EMAIL_LIMIT);
      recordFailure(ipKey, IP_LIMIT);
      throw new ApiError(401, "invalid email or password");
    }

    recordSuccess(emailKey);
    recordSuccess(ipKey);

    const { passwordHash: _passwordHash, ...user } = userAuth!;
    const res = NextResponse.json({ data: user });
    const { token } = createSession(user.id);
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
