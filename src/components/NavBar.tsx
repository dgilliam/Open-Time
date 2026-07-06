"use client";

// Session-aware nav: Timer/Timesheet/Calendar/Reports for everyone, Dashboard
// + Team for admins only, and a sign-out control at the bottom. Rendered only
// once AppShell has confirmed a user is signed in, so `user` here is never
// null in practice — the fallback guards keep this component safe to reuse
// anywhere.
//
// v2.3: this is now reused as both the desktop sidebar and the mobile
// off-canvas drawer's contents (AppShell decides which via CSS classes on
// the same <nav>). `collapsed`/`onToggleCollapse` drive the desktop-only
// collapse chevron at the top; `open` just adds the class the drawer's CSS
// transform keys off of.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import { useSession } from "./SessionContext";
import { NavToggle } from "./NavToggle";

const BASE_LINKS = [
  { href: "/", label: "Timer" },
  { href: "/timesheet", label: "Timesheet" },
  { href: "/calendar", label: "Calendar" },
  { href: "/reports", label: "Reports" },
];

export function NavBar({
  open,
  onToggleCollapse,
}: {
  /** Mobile drawer open state — adds the class the CSS transform keys off of. */
  open?: boolean;
  /** Desktop-only collapse chevron handler; omitted, the chevron isn't shown. */
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, setUser } = useSession();

  const links =
    user?.role === "admin"
      ? [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/invoices", label: "Invoices" },
          ...BASE_LINKS,
          { href: "/team", label: "Team" },
        ]
      : BASE_LINKS;

  async function handleSignOut() {
    try {
      await logout();
    } finally {
      setUser(null);
      router.replace("/login");
    }
  }

  return (
    <nav className={open ? "nav nav-open" : "nav"}>
      <div className="nav-top">
        <div className="nav-brand">Open-Time</div>
        {onToggleCollapse && (
          <NavToggle
            className="nav-collapse-btn"
            onClick={onToggleCollapse}
            ariaLabel="Collapse sidebar"
            ariaExpanded={true}
          >
            ‹
          </NavToggle>
        )}
      </div>
      <ul className="nav-links">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={pathname === link.href ? "nav-link active" : "nav-link"}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
      {user && (
        <div className="nav-user">
          <span className="nav-user-label">Signed in as</span>
          <span className="strong">{user.name}</span>
          <button type="button" className="btn-link" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
