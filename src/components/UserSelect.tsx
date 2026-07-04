"use client";

// Admin-only person picker, reused on the Calendar and Reports pages.
// Members never see this — the pages that render it check role themselves.

import type { User } from "@/lib/types";

export function UserSelect({
  users,
  value,
  onChange,
  label = "Viewing",
}: {
  users: User[];
  value: string;
  onChange: (userId: string) => void;
  label?: string;
}) {
  return (
    <label className="inline-label user-select">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}
