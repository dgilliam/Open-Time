"use client";

// Gates every route: /login and /setup render standalone (no sidebar), and
// manage their own signed-in/setup-needed redirects. Every other route
// requires a session — while it resolves, or if it's missing, we render
// nothing rather than flashing protected content, then redirect to /login.
//
// v2.3: also owns the responsive nav chrome — desktop sidebar collapse
// (persisted, with a floating expand button) and the <900px off-canvas
// drawer (slim top bar + hamburger + scrim). Both pieces of UI state live
// here because they wrap the same <NavBar>; the collapsed flag is read from
// localStorage in the initial-state callback, so it's already correct by
// this component's very first paint (AppShell renders null until the
// session resolves, so there is no server-rendered nav to mismatch against
// — no flash, no reflow).

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./SessionContext";
import { NavBar } from "./NavBar";
import { NavToggle } from "./NavToggle";

const PUBLIC_PATHS = new Set(["/login", "/setup"]);
const NAV_COLLAPSED_KEY = "opentime.navCollapsed";
const DESKTOP_BREAKPOINT = 900;

function readNavCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useSession();
  const isPublic = PUBLIC_PATHS.has(pathname);

  const [navCollapsed, setNavCollapsed] = useState<boolean>(readNavCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (loading || isPublic) return;
    if (!user) router.replace("/login");
  }, [loading, isPublic, user, router]);

  // Route change closes the mobile drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  // Safety net: if the viewport widens past the desktop breakpoint while the
  // drawer happens to be open, close it so the scrim/off-canvas state can't
  // linger into the desktop layout.
  useEffect(() => {
    if (!drawerOpen) return;
    function onResize() {
      if (window.innerWidth >= DESKTOP_BREAKPOINT) setDrawerOpen(false);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [drawerOpen]);

  function toggleCollapsed() {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore (private browsing, storage disabled, etc.)
      }
      return next;
    });
  }

  if (isPublic) {
    return <div className="auth-shell">{children}</div>;
  }

  if (loading || !user) {
    return null;
  }

  return (
    <div className={navCollapsed ? "app-shell nav-collapsed" : "app-shell"}>
      <NavBar open={drawerOpen} onToggleCollapse={toggleCollapsed} />
      {navCollapsed && (
        <NavToggle
          className="nav-expand-btn"
          onClick={toggleCollapsed}
          ariaLabel="Expand sidebar"
          ariaExpanded={false}
        >
          ›
        </NavToggle>
      )}
      <div className="app-content">
        <div className="topbar">
          <NavToggle
            className="nav-hamburger"
            onClick={() => setDrawerOpen((v) => !v)}
            ariaLabel="Open navigation"
            ariaExpanded={drawerOpen}
          >
            ☰
          </NavToggle>
          <span className="topbar-wordmark">Open-Time</span>
        </div>
        {drawerOpen && (
          <div className="nav-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        )}
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
