import { NextRequest, NextResponse } from "next/server";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_VERIFIER_COOKIE,
  appBaseUrl,
  googleAuthUrl,
  googleEnabled,
  googleRedirectUri,
  pkceChallenge,
  randomToken,
} from "@/lib/google";

export const dynamic = "force-dynamic";

/**
 * Kicks off "Sign in with Google" (v3.6): stores single-use state + PKCE
 * verifier in short-lived httpOnly cookies, then redirects to Google's
 * consent screen. GET because it's a plain top-level navigation from the
 * login page's button.
 */
export async function GET(req: NextRequest) {
  const base = appBaseUrl(req);
  if (!googleEnabled()) {
    return NextResponse.redirect(new URL("/login?error=google_unconfigured", base));
  }

  const state = randomToken();
  const verifier = randomToken(48);

  const url = new URL(googleAuthUrl());
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", googleRedirectUri(base));
  url.searchParams.set("response_type", "code");
  // profile is included for the display name used by auto-provisioning
  // (v3.7); without it Google's userinfo returns only the email.
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Always show the account chooser — several members share machines with
  // personal accounts, and a silent wrong-account pick just yields the
  // "not a member" error.
  url.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(url);
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const, // must survive the top-level redirect back from Google
    path: "/",
    maxAge: 10 * 60,
    secure: process.env.NODE_ENV === "production",
  };
  res.cookies.set(GOOGLE_STATE_COOKIE, state, cookie);
  res.cookies.set(GOOGLE_VERIFIER_COOKIE, verifier, cookie);
  return res;
}
