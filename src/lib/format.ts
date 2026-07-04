// Duration/date formatting helpers. All storage/API times are ISO-8601 UTC;
// these helpers render them in the viewer's local time.

/** Format a number of seconds as "h:mm:ss" (or "h:mm" when short=true). */
export function formatHms(totalSeconds: number, short = false): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (short) {
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  }
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Format a number of seconds as decimal hours, trimming trailing zeros, e.g. "1.5h". */
export function hoursLabel(totalSeconds: number, digits = 2): string {
  const hours = totalSeconds / 3600;
  const fixed = hours.toFixed(digits);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return `${trimmed === "" ? "0" : trimmed}h`;
}

/** Format cents as a dollar string, e.g. 12345 -> "$123.45". */
export function formatDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format an ISO timestamp as a local time string, e.g. "9:05 AM". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Format an ISO timestamp as a local date + time string. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Format an ISO timestamp as a short local date, e.g. "Jul 4". */
export function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Returns the Monday (local time, midnight) of the week containing `date`. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

/** Local midnight for the given date, stripped of time-of-day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Converts a local Date to an ISO-8601 UTC string. */
export function toIso(date: Date): string {
  return date.toISOString();
}

/** Label for a Mon-Sun week range, e.g. "Jun 29 – Jul 5". */
export function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  return `${formatShortDate(monday)} – ${formatShortDate(sunday)}`;
}

/**
 * Converts an ISO-8601 UTC string to a value suitable for an
 * <input type="datetime-local" step="1">, in local time, including seconds.
 * Seconds precision matters here: entries created via quick start/stop can be
 * under a minute long, and truncating to minute granularity would make the
 * start/stop times equal (which the API rejects) as soon as the form is saved.
 */
export function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

/** Converts an <input type="datetime-local"> value (local time, no timezone) to an ISO-8601 UTC string. */
export function fromDatetimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

/** Duration in seconds between two ISO timestamps; if stoppedAt is null, uses `now`. */
export function durationSeconds(startedAt: string, stoppedAt: string | null, now: Date = new Date()): number {
  const start = new Date(startedAt).getTime();
  const end = stoppedAt ? new Date(stoppedAt).getTime() : now.getTime();
  return Math.max(0, (end - start) / 1000);
}

/** Format a local Date as a "YYYY-MM-DD" string for an <input type="date">. */
export function dateInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a "YYYY-MM-DD" <input type="date"> value as a local-midnight Date. */
export function parseLocalDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** First day of the local-time month containing `date`. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
