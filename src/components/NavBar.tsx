"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUser } from "./UserContext";

const LINKS = [
  { href: "/", label: "Timer" },
  { href: "/timesheet", label: "Timesheet" },
  { href: "/projects", label: "Projects" },
  { href: "/reports", label: "Reports" },
];

export function NavBar() {
  const pathname = usePathname();
  const { users, userId, setUserId, loading, error } = useUser();

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
          <span className="muted">No users</span>
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
      </div>
    </nav>
  );
}
