// "Sign in with Google" (v3.6): hand-rolled OIDC authorization-code flow
// with PKCE — two routes and this helper module, no new dependencies. Google
// only replaces the "prove you own this email" step; on success the callback
// mints the exact same ot_session cookie as password login, so everything
// downstream (guards, roles, sessions) is untouched. Membership stays
// closed: the verified Google email must match an existing, non-removed
// member or the login is refused — there is no self-registration.
//
// The three Google endpoints are env-overridable so tests (and local
// end-to-end runs) can point them at a stub server; production never sets
// the overrides.

import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_STATE_COOKIE = "ot_google_state";
export const GOOGLE_VERIFIER_COOKIE = "ot_google_verifier";

export function googleAuthUrl(): string {
  return process.env.GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
}

export function googleTokenUrl(): string {
  return process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
}

export function googleUserinfoUrl(): string {
  return process.env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo";
}

/** Google login is offered only when both client credentials are configured. */
export function googleEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The app's public base URL as the BROWSER sees it — required for the
 * redirect URI sent to Google and for the OAuth routes' own redirects.
 * Behind a reverse proxy (Railway), req.nextUrl.origin is the app's
 * internal address (e.g. https://localhost:8080), so: explicit
 * OPENTIME_BASE_URL wins, then the proxy's x-forwarded-host/proto
 * headers, then the raw request origin (correct for local dev).
 */
export function appBaseUrl(req: { headers: Headers; nextUrl: { origin: string } }): string {
  if (process.env.OPENTIME_BASE_URL) return process.env.OPENTIME_BASE_URL.replace(/\/$/, "");
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }
  return req.nextUrl.origin;
}

/** The absolute callback URL registered with Google. */
export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** Random URL-safe string for `state` and the PKCE code verifier. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** S256 PKCE challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Exchanges an authorization code for tokens, then resolves the user's
 * verified email via the OIDC userinfo endpoint. Returns null (never throws
 * caller-visible detail) on any upstream failure — the callback route turns
 * that into a generic retry message.
 */
export async function resolveGoogleEmail(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ email: string; emailVerified: boolean } | null> {
  try {
    const tokenRes = await fetch(googleTokenUrl(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }),
    });
    if (!tokenRes.ok) return null;
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return null;

    const infoRes = await fetch(googleUserinfoUrl(), {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!infoRes.ok) return null;
    const info = (await infoRes.json()) as { email?: string; email_verified?: boolean };
    if (!info.email) return null;
    return { email: info.email, emailVerified: info.email_verified === true };
  } catch {
    return null;
  }
}
