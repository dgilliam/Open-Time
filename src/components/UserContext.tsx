"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "@/lib/api";
import type { User } from "@/lib/types";

const STORAGE_KEY = "opentime.userId";

interface UserContextValue {
  users: User[];
  loading: boolean;
  error: string | null;
  userId: string | null;
  setUserId: (id: string) => void;
  user: User | null;
  reload: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserIdState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(STORAGE_KEY);
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api
      .listUsers()
      .then((list) => {
        setUsers(list);
        setUserIdState((current) => {
          if (current && list.some((u) => u.id === current)) return current;
          return list[0]?.id ?? null;
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setUserId = useCallback((id: string) => {
    setUserIdState(id);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const user = users.find((u) => u.id === userId) ?? null;

  return (
    <UserContext.Provider value={{ users, loading, error, userId, setUserId, user, reload: load }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within a UserProvider");
  return ctx;
}
