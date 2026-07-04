"use client";

// Admin-only user list + Add member dialog. Members are redirected to /.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createUser, listUsers } from "@/lib/api";
import type { User } from "@/lib/types";
import { Dialog } from "@/components/Dialog";
import { useSession } from "@/components/SessionContext";

export default function TeamPage() {
  const { user } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    }
  }, [user, router]);

  useEffect(() => {
    if (user?.role === "admin") {
      listUsers()
        .then((u) => {
          setUsers(u);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
  }, [user]);

  if (!user || user.role !== "admin") return null;

  return (
    <div className="page">
      <h1>Team</h1>
      <div className="toolbar">
        <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
          Add member
        </button>
      </div>
      {loaded && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="strong">{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className="badge">{u.role}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showAdd && (
        <AddMemberDialog
          onClose={() => setShowAdd(false)}
          onCreated={(created) => {
            setUsers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddMemberDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (user: User) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("password must be at least 8 characters");
      return;
    }
    setSaving(true);
    try {
      const created = await createUser({ name, email, password });
      onCreated(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to create member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Add member" onClose={onClose}>
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
          Temporary password
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Adding…" : "Add member"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
