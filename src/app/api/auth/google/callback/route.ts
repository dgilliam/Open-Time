import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
  appBaseUrl,
  googleEnabled,
  googleRedirectUri,
  resolveGoogleEmail,
} from "@/lib/google";
import { getUserAuthByEmail } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * Google OAuth callback (v3.6). On a verified email that matches an
 * existing, non-removed member, mints the same ot_session cookie password
 * login uses and lands on "/". Every failure path redirects back to /login
 * with a coarse error code — no detail that would let someone probe which
 * emails are members beyond what the login form already reveals.
 */
export async function GET(req: NextRequest) {
  // The public base URL (proxy-aware) — the browser must be redirected to
  // the real site, never the app's internal origin behind Railway's proxy.
  const base = appBaseUrl(req);
  const loginRedirect = (error: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${error}`, base));
    res.cookies.delete(GOOGLE_STATE_COOKIE);
    res.cookies.delete(GOOGLE_VERIFIER_COOKIE);
    return res;
  };

  if (!googleEnabled()) return loginRedirect("google_unconfigured");

  const params = req.nextUrl.searchParams;
  // User cancelled on Google's screen (or Google reported an error).
  if (params.get("error")) return loginRedirect("google_cancelled");

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = req.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  const verifier = req.cookies.get(GOOGLE_VERIFIER_COOKIE)?.value;
  if (!code || !state || !cookieState || !verifier || state !== cookieState) {
    return loginRedirect("google_failed");
  }

  const identity = await resolveGoogleEmail({
    code,
    codeVerifier: verifier,
    redirectUri: googleRedirectUri(base),
  });
  if (!identity) return loginRedirect("google_failed");
  if (!identity.emailVerified) return loginRedirect("google_failed");

  const userAuth = getUserAuthByEmail(identity.email);
  if (!userAuth) return loginRedirect("not_member");

  const res = NextResponse.redirect(new URL("/", base));
  res.cookies.delete(GOOGLE_STATE_COOKIE);
  res.cookies.delete(GOOGLE_VERIFIER_COOKIE);
  const { token } = createSession(userAuth.id);
  setSessionCookie(res, token);
  return res;
}
