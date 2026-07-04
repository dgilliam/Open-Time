"use client";

// First-run admin account creation. Shown only when the users table is
// empty (checked server-side via GET /api/setup); otherwise redirects to
// /login, and to / when already signed in.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getSetupStatus, setup } from "@/lib/api";
import { useSession } from "@/components/SessionContext";

export default function SetupPage() {
  const { user, loading, refresh } = useSession();
  const router = useRouter();
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getSetupStatus()
      .then((s) => setNeeded(s.needed))
      .catch(() => setNeeded(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace("/");
      return;
    }
    if (needed === false) router.replace("/login");
  }, [loading, user, needed, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      await setup({ name, email, password });
      await refresh();
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to create admin account");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user || needed === null || needed === false) return null;

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
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create admin account"}
        </button>
      </form>
    </div>
  );
}
