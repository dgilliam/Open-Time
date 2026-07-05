import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { ApiError } from "./types";
import type { User } from "./types";

export const SESSION_COOKIE = "ot_session";
const SESSION_DAYS = 30;
const SCRYPT_KEYLEN = 64;

// ---------- password hashing (scrypt via node:crypto — no new native deps) ----------

/** Hashes a plaintext password as `salt:hex(scrypt(password, salt))`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

/** Verifies a plaintext password against a hash produced by hashPassword. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const derived = scryptSync(password, salt, hashBuf.length);
  if (derived.length !== hashBuf.length) return false;
  return timingSafeEqual(derived, hashBuf);
}

// ---------- sessions ----------
// The session cookie holds a random opaque token; only its SHA-256 hash is
// stored in the sessions table, so a leaked DB row can't be replayed as a
// cookie.

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface SessionUserRow {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  created_at: string;
  project: string | null;
}

function rowToUser(row: SessionUserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    project: row.project ?? null,
  };
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const createdAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
  ).run(tokenHash, userId, expiresAt, createdAt);
  return { token, expiresAt };
}

/** Resolves a raw session token to its user, or null if missing/expired. */
export function getSessionUser(token: string | undefined | null): User | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT u.id as id, u.name as name, u.email as email, u.role as role, u.created_at as created_at,
              u.project as project
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, new Date().toISOString()) as SessionUserRow | undefined;
  return row ? rowToUser(row) : null;
}

export function deleteSession(token: string | undefined | null): void {
  if (!token) return;
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// ---------- route guards ----------
// Route handlers stay thin: they call requireUser/requireAdmin (or
// assertSelfOrAdmin once they already have the acting user) and let the
// thrown ApiError bubble up to apiErrorResponse.

export function requireUser(req: NextRequest): User {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = getSessionUser(token);
  if (!user) throw new ApiError(401, "authentication required");
  return user;
}

export function requireAdmin(req: NextRequest): User {
  const user = requireUser(req);
  if (user.role !== "admin") throw new ApiError(403, "admin only");
  return user;
}

/** Members may only target themselves; admins may target anyone. */
export function assertSelfOrAdmin(user: User, targetUserId: string): void {
  if (user.role !== "admin" && user.id !== targetUserId) {
    throw new ApiError(403, "forbidden");
  }
}
