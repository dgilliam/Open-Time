"use client";

// v1's nav depended on UserContext (a v1-only user-picker + localStorage
// concept, incompatible with real sessions). Session-aware nav — signed-in
// name, Sign out, Team link for admins — is T6's job (see docs/PLAN.md).
// This is a compile-safe stub: static links only, no user/session data.

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Timer" },
  { href: "/timesheet", label: "Timesheet" },
  { href: "/projects", label: "Projects" },
  { href: "/reports", label: "Reports" },
];

export function NavBar() {
  const pathname = usePathname();

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
    </nav>
  );
}
