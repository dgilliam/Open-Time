"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import { useUser } from "./UserContext";
import { Dialog } from "./Dialog";

const LINKS = [
  { href: "/", label: "Timer" },
  { href: "/timesheet", label: "Timesheet" },
  { href: "/projects", label: "Projects" },
  { href: "/reports", label: "Reports" },
];

function AddTeammateDialog({ onClose }: { onClose: () => void }) {
  const { setUserId, reload } = useUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.createUser({ name: name.trim(), email: email.trim() });
      setUserId(created.id);
      reload();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <Dialog title="Add teammate" onClose={saving ? () => {} : onClose}>
      <form onSubmit={handleSubmit} className="form">
        {error && <p className="error-text">{error}</p>}
        <label>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function NavBar() {
  const pathname = usePathname();
  const { users, userId, setUserId, loading, error } = useUser();
  const [adding, setAdding] = useState(false);

  return (
    <nav className="nav">
      <div className="nav-brand">Open-Time</div>
      <ul className="nav-links">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={pathname === link.href ? "nav-link active" : "nav-link"}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      <div className="nav-user">
        <label htmlFor="user-picker" className="nav-user-label">
          User
        </label>
        {loading ? (
          <span className="muted">Loading…</span>
        ) : error ? (
          <span className="error-text">{error}</span>
        ) : users.length === 0 ? (
          <span className="muted">No users yet</span>
        ) : (
          <select
            id="user-picker"
            value={userId ?? ""}
            onChange={(e) => setUserId(e.target.value)}
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        {!loading && (
          <button type="button" className="btn-link" onClick={() => setAdding(true)}>
            + Add teammate
          </button>
        )}
      </div>
      {adding && <AddTeammateDialog onClose={() => setAdding(false)} />}
    </nav>
  );
}
