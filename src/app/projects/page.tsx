"use client";

import { useCallback, useEffect, useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { Project } from "@/lib/types";
import { ColorDot } from "@/components/ColorDot";
import { ProjectDialog } from "@/components/ProjectDialog";
import { formatDollars } from "@/lib/format";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // create form state
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [color, setColor] = useState("#4f46e5");
  const [rate, setRate] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .listProjects({ includeArchived: showArchived })
      .then(setProjects)
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    document.title = "Open-Time — Projects";
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const trimmedRate = rate.trim();
      await api.createProject({
        name,
        client: client.trim() ? client.trim() : null,
        color,
        hourlyRateCents: trimmedRate ? Math.round(parseFloat(trimmedRate) * 100) : null,
      });
      setName("");
      setClient("");
      setColor("#4f46e5");
      setRate("");
      load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleArchived(project: Project) {
    setBusyId(project.id);
    setError(null);
    try {
      await api.updateProject(project.id, { archived: !project.archived });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <h1>Projects</h1>

      <section className="section">
        <h2>New project</h2>
        <form onSubmit={handleCreate} className="form form-row">
          {createError && <p className="error-text">{createError}</p>}
          <label>
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Client
            <input type="text" value={client} onChange={(e) => setClient(e.target.value)} />
          </label>
          <label>
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <label>
            Rate ($/hour)
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="e.g. 75.00"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating}>
            Add project
          </button>
        </form>
      </section>

      <section className="section">
        <div className="toolbar">
          <h2>All projects</h2>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
        </div>
        {error && <p className="error-text">{error}</p>}
        {loading ? (
          <p className="muted">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="muted">No projects yet.</p>
        ) : (
          <table className="entry-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Rate</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="project-cell">
                      <ColorDot color={p.color} />
                      {p.name}
                    </span>
                  </td>
                  <td>{p.client || <span className="muted">—</span>}</td>
                  <td>{p.hourlyRateCents === null ? "—" : `${formatDollars(p.hourlyRateCents)}/h`}</td>
                  <td>{p.archived && <span className="badge">Archived</span>}</td>
                  <td className="row-actions">
                    <button type="button" className="btn-link" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => handleToggleArchived(p)}
                      disabled={busyId === p.id}
                    >
                      {p.archived ? "Unarchive" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {editing && (
        <ProjectDialog
          project={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
