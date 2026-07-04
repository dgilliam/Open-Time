"use client";

import { useState } from "react";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/types";
import type { Project } from "@/lib/types";
import { Dialog } from "./Dialog";

function dollarsFromCents(cents: number | null): string {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
}

export function ProjectDialog({
  project,
  onClose,
  onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [client, setClient] = useState(project.client ?? "");
  const [color, setColor] = useState(project.color);
  const [rate, setRate] = useState(dollarsFromCents(project.hourlyRateCents));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const trimmedRate = rate.trim();
      await api.updateProject(project.id, {
        name,
        client: client.trim() ? client.trim() : null,
        color,
        hourlyRateCents: trimmedRate ? Math.round(parseFloat(trimmedRate) * 100) : null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog title="Edit project" onClose={onClose}>
      <form onSubmit={handleSubmit} className="form">
        {error && <p className="error-text">{error}</p>}
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
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
