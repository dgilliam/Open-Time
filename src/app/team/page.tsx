"use client";

// Admin-only user list + Add member dialog. Members are redirected to /.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, createUser, listUsers, removeUser, restoreUser, updateUser } from "@/lib/api";
import { pluralCount } from "@/lib/format";
import type { User } from "@/lib/types";
import { Dialog } from "@/components/Dialog";
import { useSession } from "@/components/SessionContext";

export default function TeamPage() {
  const { user } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    }
  }, [user, router]);

  const refetch = useCallback(
    (includeRemoved: boolean) => {
      if (user?.role !== "admin") return;
      listUsers({ includeRemoved })
        .then((u) => {
          setUsers(u);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    },
    [user]
  );

  useEffect(() => {
    refetch(showRemoved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, showRemoved]);

  if (!user || user.role !== "admin") return null;

  const activeUsers = users.filter((u) => !u.deletedAt);
  const removedUsers = users.filter((u) => u.deletedAt);

  async function handleRemove(target: User) {
    if (!confirm(`Remove ${target.name}? They will no longer be able to log in, but their time entries are kept.`)) {
      return;
    }
    try {
      await removeUser(target.id);
      refetch(showRemoved);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "failed to remove member");
    }
  }

  async function handleRestore(target: User) {
    try {
      await restoreUser(target.id);
      refetch(showRemoved);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "failed to restore member");
    }
  }

  return (
    <div className="page">
      <h1>Team</h1>
      <div className="toolbar">
        <button type="button" className="btn-primary" onClick={() => setShowAdd(true)}>
          Add member
        </button>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showRemoved}
            onChange={(e) => setShowRemoved(e.target.checked)}
          />
          Show removed
        </label>
      </div>
      {loaded && (
        <>
          <div className="table-count">
            {pluralCount(activeUsers.length, "member")}
            {showRemoved && removedUsers.length > 0 && ` · ${pluralCount(removedUsers.length, "removed", "removed")}`}
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Project</th>
                  <th aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u) => (
                  <tr key={u.id}>
                    <td className="strong">{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <span className="badge">{u.role}</span>
                    </td>
                    <td className="muted">{u.project ?? "—"}</td>
                    <td className="row-actions">
                      <button type="button" className="btn-link" onClick={() => setEditing(u)}>
                        Edit
                      </button>
                      {u.id !== user.id && (
                        <button
                          type="button"
                          className="btn-link btn-link-danger"
                          onClick={() => handleRemove(u)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {showRemoved &&
                  removedUsers.map((u) => (
                    <tr key={u.id} style={{ opacity: 0.5 }}>
                      <td className="strong">{u.name}</td>
                      <td>{u.email}</td>
                      <td>
                        <span className="badge">{u.role}</span>
                      </td>
                      <td className="muted">{u.project ?? "—"}</td>
                      <td className="row-actions">
                        <button type="button" className="btn-link" onClick={() => handleRestore(u)}>
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
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
      {editing && (
        <EditMemberDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setUsers((prev) =>
              prev.map((u) => (u.id === updated.id ? updated : u)).sort((a, b) => a.name.localeCompare(b.name))
            );
            setEditing(null);
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
  const [project, setProject] = useState("");
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
      const created = await createUser({ name, email, password, project: project || undefined });
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
        <label>
          Project <span className="muted">(optional)</span>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            maxLength={60}
            placeholder="e.g. AI Assessor"
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

function EditMemberDialog({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: (user: User) => void;
}) {
  const [name, setName] = useState(user.name);
  const [project, setProject] = useState(user.project ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      // password only rides along when actually typed — blank keeps the
      // member's current login untouched.
      const updated = await updateUser(user.id, {
        name,
        project,
        password: password || undefined,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "failed to save member");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Edit member" onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Email <span className="muted">(read-only)</span>
          <input type="email" value={user.email} disabled />
        </label>
        <label>
          Project <span className="muted">(optional)</span>
          <input
            type="text"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            maxLength={60}
            placeholder="e.g. AI Assessor"
          />
        </label>
        <label>
          New password <span className="muted">(optional — resets their login, min 8 chars)</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            autoComplete="off"
            placeholder="leave blank to keep current"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
