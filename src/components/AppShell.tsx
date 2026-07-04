"use client";

// Gates every route: /login and /setup render standalone (no sidebar), and
// manage their own signed-in/setup-needed redirects. Every other route
// requires a session — while it resolves, or if it's missing, we render
// nothing rather than flashing protected content, then redirect to /login.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "./SessionContext";
import { NavBar } from "./NavBar";

const PUBLIC_PATHS = new Set(["/login", "/setup"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useSession();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (loading || isPublic) return;
    if (!user) router.replace("/login");
  }, [loading, isPublic, user, router]);

  if (isPublic) {
    return <div className="auth-shell">{children}</div>;
  }

  if (loading || !user) {
    return null;
  }

  return (
    <div className="app-shell">
      <NavBar />
      <main className="app-main">{children}</main>
    </div>
  );
}
