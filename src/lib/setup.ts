// First-run setup gating (security review 2026-08-15).
//
// POST /api/setup mints an *admin* with no authentication, gated only on the
// users table being empty. The deploy-window exposure is understood and
// accepted (the founder visits /setup right after the first deploy), but the
// durable hole was different: if the Railway volume is ever detached,
// remounted empty, or OPENTIME_DB is repointed, db.ts recreates the schema
// from scratch and /setup silently reopens on a live public URL. The first
// visitor would become admin over the restored data.
//
// Two guards close that, in order of preference:
//
//   1. OPENTIME_SETUP_TOKEN — when set, the token must be presented to
//      create the admin. This is the real control, and DEPLOY.md now tells
//      you to set it. A token holder can always run setup.
//
//   2. Backup detection — when no token is configured, an existing snapshot
//      in the backup directory means this deployment has held data before.
//      An empty users table then indicates a storage incident, not a fresh
//      install, so setup refuses and points at restore instead.
//
// With neither a token nor any backups on disk, this is a genuinely fresh
// install and setup proceeds as it always did.

import { createHash, timingSafeEqual } from "node:crypto";
import { latestBackupDate } from "./backup";
import { countUsers } from "./repo";
import { ApiError } from "./types";

/** Length-independent constant-time compare (digests, so both sides are 32 bytes). */
function secretEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function setupTokenRequired(): boolean {
  return Boolean(process.env.OPENTIME_SETUP_TOKEN);
}

export interface SetupStatus {
  /** The setup form should be offered. */
  needed: boolean;
  /** The form must collect a setup token. */
  tokenRequired: boolean;
  /** Setup is refused despite an empty users table; `reason` says why. */
  blocked: boolean;
  reason?: string;
}

export function setupStatus(): SetupStatus {
  const tokenRequired = setupTokenRequired();
  if (countUsers() > 0) return { needed: false, tokenRequired, blocked: false };

  if (!tokenRequired && latestBackupDate()) {
    return {
      needed: false,
      tokenRequired,
      blocked: true,
      reason:
        "this deployment has existing backups but no accounts — restore the database instead of running setup",
    };
  }
  return { needed: true, tokenRequired, blocked: false };
}

/**
 * Throws unless first-run setup may proceed. Callers must invoke this and
 * createUser without an intervening `await` — the original route checked the
 * user count, then awaited the request body, leaving a window in which two
 * concurrent requests could both pass the check.
 */
export function assertSetupAllowed(token: string): void {
  if (countUsers() > 0) throw new ApiError(409, "setup already completed");

  const expected = process.env.OPENTIME_SETUP_TOKEN;
  if (expected) {
    if (!token || !secretEquals(token, expected)) {
      throw new ApiError(403, "invalid setup token");
    }
    return;
  }

  const backup = latestBackupDate();
  if (backup) {
    throw new ApiError(
      409,
      `refusing to run setup: this deployment has backups (newest ${backup}) but no accounts. ` +
        "Restore the database, or set OPENTIME_SETUP_TOKEN to authorize a deliberate re-setup."
    );
  }
}
