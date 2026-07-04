"use client";

// Client-side session state, loaded once from /api/auth/me. Pages that need
// to know "who is signed in" (and the nav, and route guards) read this
// instead of each fetching /api/auth/me themselves.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { me } from "@/lib/api";
import type { User } from "@/lib/types";

interface SessionState {
  user: User | null;
  /** True until the initial /api/auth/me call resolves. */
  loading: boolean;
  /** Re-fetches /api/auth/me (call after login/setup/logout). */
  refresh: () => Promise<void>;
  /** Optimistic local update, e.g. clearing the user immediately on sign out. */
  setUser: (user: User | null) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const current = await me();
      setUser(current);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ user, loading, refresh, setUser }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
