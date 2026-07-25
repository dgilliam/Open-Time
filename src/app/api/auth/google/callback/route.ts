import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
  appBaseUrl,
  autoProvisionDomains,
  googleEnabled,
  googleRedirectUri,
  resolveGoogleEmail,
} from "@/lib/google";
import { createUser, getUserAuthByEmail } from "@/lib/repo";
import { randomBytes } from "node:crypto";

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

  let userId = getUserAuthByEmail(identity.email)?.id ?? null;

  // Auto-provisioning (v3.7): a verified email on an allow-listed domain
  // that matches no member becomes a member on first sign-in. createUser
  // refuses emails held by removed members, so offboarding stays
  // authoritative — a removed teammate can't re-add themselves.
  if (!userId) {
    const domain = identity.email.split("@").pop()?.toLowerCase() ?? "";
    if (!autoProvisionDomains().includes(domain)) return loginRedirect("not_member");
    try {
      const created = createUser({
        name: identity.name ?? identity.email.split("@")[0],
        email: identity.email,
        // Never used — Google is their login. An admin can reset it from
        // the Team page if they ever need the password fallback.
        password: randomBytes(24).toString("base64url"),
        role: "member",
      });
      userId = created.id;
    } catch {
      return loginRedirect("not_member");
    }
  }

  const res = NextResponse.redirect(new URL("/", base));
  res.cookies.delete(GOOGLE_STATE_COOKIE);
  res.cookies.delete(GOOGLE_VERIFIER_COOKIE);
  const { token } = createSession(userId);
  setSessionCookie(res, token);
  return res;
}
