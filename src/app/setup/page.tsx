"use client";

// First-run admin account creation. Shown only when the users table is
// empty (checked server-side via GET /api/setup); otherwise redirects to
// /login, and to / when already signed in.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getSetupStatus, setup, type SetupStatus } from "@/lib/api";
import { useSession } from "@/components/SessionContext";

export default function SetupPage() {
  const { user, loading, refresh } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const needed = status?.needed ?? null;

  useEffect(() => {
    getSetupStatus()
      .then(setStatus)
      .catch(() => setStatus({ needed: false, tokenRequired: false, blocked: false }));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace("/");
      return;
    }
    // A blocked deployment stays on this page to explain itself — bouncing to
    // /login would strand the operator with no idea why setup vanished.
    if (needed === false && !status?.blocked) router.replace("/login");
  }, [loading, user, needed, status?.blocked, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      await setup({ name, email, password, token: token || undefined });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to create admin account");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user || status === null) return null;

  if (status.blocked) {
    return (
      <div className="auth-card">
        <h1>Setup unavailable</h1>
        <p className="error-text">{status.reason}</p>
        <p className="muted">
          See DEPLOY.md — restore the most recent snapshot from the backup directory, or set
          OPENTIME_SETUP_TOKEN on the service to authorize a deliberate re-setup.
        </p>
      </div>
    );
  }

  if (!status.needed) return null;

  return (
    <div className="auth-card">
      <h1>Set up Open-Time</h1>
      <p className="muted">Create the admin account. This only happens once.</p>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {status.tokenRequired && (
          <label>
            Setup token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
              autoComplete="off"
            />
            <span className="muted">The OPENTIME_SETUP_TOKEN configured on this service.</span>
          </label>
        )}
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}
