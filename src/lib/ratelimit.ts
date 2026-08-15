// Failed-login throttling (security review 2026-08-15).
//
// Open-Time is a single Node process with a SQLite file, so an in-memory
// limiter is the right size: no shared store to run, and a restart clearing
// the counters is acceptable — an attacker can't trigger restarts.
//
// Two independent buckets guard the login route, and BOTH must allow a
// request through:
//   - per-email  — stops a targeted brute force against one account.
//   - per-IP     — stops password spraying across many accounts from one host.
// Keying on the email as well as the IP is what makes a spoofed
// x-forwarded-for useless: forging it isolates the attacker into a fresh IP
// bucket, but the account's own bucket keeps counting.
//
// The first FREE_ATTEMPTS failures cost nothing (people fat-finger their
// password); after that each failure doubles a lockout window, capped. A
// success clears the bucket immediately.

export interface RateLimitOptions {
  /** Failures allowed before any delay is imposed. */
  freeAttempts: number;
  /** Lockout applied at the first failure past freeAttempts; doubles thereafter. */
  baseDelayMs: number;
  /** Ceiling for the doubling. */
  maxDelayMs: number;
}

export const EMAIL_LIMIT: RateLimitOptions = {
  freeAttempts: 5,
  baseDelayMs: 2_000,
  maxDelayMs: 15 * 60_000,
};

// Deliberately looser: a whole office can share one NAT address, and locking
// that out would be a self-inflicted outage. It's a spraying backstop, not
// the primary control.
export const IP_LIMIT: RateLimitOptions = {
  freeAttempts: 20,
  baseDelayMs: 1_000,
  maxDelayMs: 5 * 60_000,
};

/** A bucket idle this long is forgotten entirely. */
const IDLE_TTL_MS = 60 * 60_000;
/** Prune only once the map is big enough to be worth sweeping. */
const PRUNE_THRESHOLD = 1_000;

interface Bucket {
  failures: number;
  /** Epoch ms until which attempts are refused; 0 = not locked out. */
  blockedUntil: number;
  /** Epoch ms of the last touch, for idle pruning. */
  seenAt: number;
}

const buckets = new Map<string, Bucket>();

function prune(now: number): void {
  if (buckets.size < PRUNE_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.seenAt > IDLE_TTL_MS) buckets.delete(key);
  }
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Seconds until the caller may retry; 0 when allowed. Feeds Retry-After. */
  retryAfterSecs: number;
}

/**
 * Whether `key` may attempt right now. Read-only — call recordFailure or
 * recordSuccess afterwards to move the bucket.
 */
export function checkRateLimit(key: string, now = Date.now()): RateLimitVerdict {
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true, retryAfterSecs: 0 };

  // An expired lockout is also an idle-window reset: serving out the penalty
  // earns a clean slate rather than leaving the account one failure away
  // from another lockout forever.
  if (bucket.blockedUntil && now >= bucket.blockedUntil) {
    buckets.delete(key);
    return { allowed: true, retryAfterSecs: 0 };
  }
  if (bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSecs: Math.ceil((bucket.blockedUntil - now) / 1000) };
  }
  if (now - bucket.seenAt > IDLE_TTL_MS) {
    buckets.delete(key);
    return { allowed: true, retryAfterSecs: 0 };
  }
  return { allowed: true, retryAfterSecs: 0 };
}

/** Counts a failed attempt and, past the free allowance, arms a lockout. */
export function recordFailure(key: string, opts: RateLimitOptions, now = Date.now()): void {
  prune(now);
  const bucket = buckets.get(key) ?? { failures: 0, blockedUntil: 0, seenAt: now };
  bucket.failures += 1;
  bucket.seenAt = now;

  // `>= 0`, not `> 0`: the failure that *reaches* freeAttempts must arm the
  // lockout, otherwise the allowance is silently one attempt larger than it
  // reads. freeAttempts: 5 means five wrong guesses, then a wait.
  const over = bucket.failures - opts.freeAttempts;
  if (over >= 0) {
    const delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** over);
    bucket.blockedUntil = now + delay;
  }
  buckets.set(key, bucket);
}

/** Clears a bucket after a successful authentication. */
export function recordSuccess(key: string): void {
  buckets.delete(key);
}

/** Test hook — drops all state. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Best-effort client address for per-IP bucketing. Behind Railway the real
 * address is the first x-forwarded-for hop. This value is NOT trusted for
 * anything but bucketing (see the module header on why spoofing it gains an
 * attacker nothing), so no proxy allow-list is needed here.
 */
export function clientIp(req: { headers: Headers }): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
