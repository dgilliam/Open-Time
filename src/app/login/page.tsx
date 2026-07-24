"use client";

// Email + password sign-in, plus "Sign in with Google" when the deployment
// has Google OAuth configured (v3.6 — see /api/auth/providers). Redirects
// to / when already signed in. Google-flow failures land back here with an
// ?error= code, mapped to friendly copy below.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, getAuthProviders, login } from "@/lib/api";
import { useSession } from "@/components/SessionContext";

const GOOGLE_ERRORS: Record<string, string> = {
  not_member: "That Google account isn't a member of this team — ask your admin to add you.",
  google_cancelled: "Google sign-in was cancelled.",
  google_failed: "Google sign-in didn't complete — try again, or use your password.",
  google_unconfigured: "Google sign-in isn't set up on this server.",
};

function LoginForm() {
  const { user, loading, refresh } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => {
    const code = searchParams.get("error");
    return code ? GOOGLE_ERRORS[code] ?? "sign-in failed — try again" : null;
  });
  const [submitting, setSubmitting] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(user.role === "admin" ? "/dashboard" : "/");
  }, [loading, user, router]);

  useEffect(() => {
    getAuthProviders()
      .then((p) => setGoogleAvailable(p.google))
      .catch(() => setGoogleAvailable(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const loggedIn = await login({ email, password });
      await refresh();
      router.replace(loggedIn.role === "admin" ? "/dashboard" : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to sign in");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user) return null;

  return (
    <div className="auth-card">
      <h1>Open-Time</h1>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {googleAvailable && (
        <>
          <div className="auth-divider">or</div>
          {/* Plain navigation, not fetch — the route 302s to Google. */}
          <a className="btn auth-google" href="/api/auth/google">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            Sign in with Google
          </a>
        </>
      )}
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
