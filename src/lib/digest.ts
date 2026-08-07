// Daily digest (v3.9): who logged hours yesterday, how many, on what.
//
// Three layers, kept separate on purpose: buildDailyDigest aggregates,
// renderDigestSlackText formats (the Dashboard preview renders exactly this
// text, so the preview IS the contract), and the delivery section at the
// bottom posts it to Slack — idempotently, via the notifications_log
// ledger. Delivery is inert unless SLACK_BOT_TOKEN + SLACK_DIGEST_CHANNEL
// are configured, so the preview works on any deployment.

import { db } from "./db";
import { listEntries, listUsers, zoneDateKey } from "./repo";
import { postSlackMessage, slackEnabled } from "./slack";

export interface DigestTaskLine {
  task: string;
  hours: number;
}

export interface DigestMemberLine {
  id: string;
  name: string;
  hours: number;
  tasks: DigestTaskLine[];
}

export interface DailyDigest {
  /** YYYY-MM-DD in the digest timezone. */
  date: string;
  totalHours: number;
  members: DigestMemberLine[]; // hours desc
  /** Active members (admin excluded) with zero hours that day. */
  noHours: string[];
}

/**
 * Aggregates one calendar day (in `tz`, server-local when omitted) of
 * completed entries into per-member, per-task lines. The admin is excluded
 * from the no-hours list — the digest tracks the team's logging, not the
 * founder's.
 */
export function buildDailyDigest(date: string, tz?: string): DailyDigest {
  // Generous UTC window around the target day (a zone day is always within
  // ±1 day of the same UTC date), filtered precisely by zoneDateKey below.
  const dayUtc = new Date(`${date}T00:00:00.000Z`);
  const from = new Date(dayUtc.getTime() - 86_400_000).toISOString();
  const to = new Date(dayUtc.getTime() + 2 * 86_400_000).toISOString();

  const entries = listEntries({ from, to }).filter(
    (e) => e.durationSecs !== null && zoneDateKey(e.startedAt, tz) === date
  );

  const memberMap = new Map<string, DigestMemberLine>();
  for (const e of entries) {
    const member = memberMap.get(e.userId) ?? { id: e.userId, name: e.userName, hours: 0, tasks: [] };
    member.hours += (e.durationSecs as number) / 3600;
    const task = member.tasks.find((t) => t.task === e.taskName);
    if (task) task.hours += (e.durationSecs as number) / 3600;
    else member.tasks.push({ task: e.taskName, hours: (e.durationSecs as number) / 3600 });
    memberMap.set(e.userId, member);
  }

  const members = Array.from(memberMap.values()).sort((a, b) => b.hours - a.hours);
  for (const m of members) m.tasks.sort((a, b) => b.hours - a.hours);

  const noHours = listUsers()
    .filter((u) => u.role !== "admin" && !memberMap.has(u.id))
    .map((u) => u.name)
    .sort((a, b) => a.localeCompare(b));

  return {
    date,
    totalHours: members.reduce((sum, m) => sum + m.hours, 0),
    members,
    noHours,
  };
}

function hoursLabel(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** "Thursday, Jul 24" from a YYYY-MM-DD key (date-only, timezone-free). */
function friendlyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Longest task name kept intact in the digest's task lines; longer names ellipsize. */
const TASK_NAME_MAX = 44;

function truncateTask(name: string): string {
  return name.length > TASK_NAME_MAX + 1 ? `${name.slice(0, TASK_NAME_MAX)}…` : name;
}

/**
 * Slack mrkdwn rendering — the exact text a future scheduler would post.
 * Kept dumb and deterministic so the Dashboard preview IS the contract.
 *
 * The member/hours table lives in a code block: Slack only renders
 * monospace (and therefore aligned columns) there, so a fenced block is the
 * only way to get a real table in a message. `tasks: false` drops the
 * per-task section for a table-only digest.
 */
export function renderDigestSlackText(d: DailyDigest, opts: { tasks?: boolean } = {}): string {
  const withTasks = opts.tasks !== false;
  const lines: string[] = [];
  lines.push(`:clock3: *Open-Time — ${friendlyDate(d.date)}*`);
  if (d.members.length === 0) {
    lines.push("_No hours logged._");
    return lines.join("\n");
  }
  lines.push(`*${d.members.length} logged · ${hoursLabel(d.totalHours)} total*`);

  // Column widths sized to the content so the table stays tight on mobile.
  const nameWidth = Math.max(6, ...d.members.map((m) => m.name.length));
  const hourCells = d.members.map((m) => hoursLabel(m.hours));
  const hoursWidth = Math.max(5, ...hourCells.map((h) => h.length));
  lines.push("```");
  lines.push(`${"Member".padEnd(nameWidth)}  ${"Hours".padStart(hoursWidth)}`);
  lines.push(`${"─".repeat(nameWidth)}  ${"─".repeat(hoursWidth)}`);
  d.members.forEach((m, i) => {
    lines.push(`${m.name.padEnd(nameWidth)}  ${hourCells[i].padStart(hoursWidth)}`);
  });
  lines.push(`${"Total".padEnd(nameWidth)}  ${hoursLabel(d.totalHours).padStart(hoursWidth)}`);
  lines.push("```");

  if (withTasks) {
    for (const m of d.members) {
      const tasks = m.tasks.map((t) => `\`${truncateTask(t.task)}\` ${hoursLabel(t.hours)}`).join(", ");
      lines.push(`• *${m.name}* — ${tasks}`);
    }
  }

  if (d.noHours.length > 0) {
    lines.push("");
    lines.push(`_No hours: ${d.noHours.join(", ")}_`);
  }
  return lines.join("\n");
}

// ---------- delivery (v3.9) ----------

const DIGEST_KIND = "daily_digest";

/** The team's timezone for digest scheduling and day boundaries. */
export function digestTimeZone(): string {
  return process.env.OPENTIME_TZ || "America/Chicago";
}

/** Local hour (0-23) of `now` in the digest timezone. */
function hourInZone(now: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now)
  );
}

/** YYYY-MM-DD of the day BEFORE `now` in the digest timezone — what a morning digest covers. */
export function digestTargetDate(now: Date, timeZone: string): string {
  return zoneDateKey(new Date(now.getTime() - 86_400_000).toISOString(), timeZone);
}

function alreadySent(key: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM notifications_log WHERE kind = ? AND key = ?").get(DIGEST_KIND, key)
  );
}

/** Records a delivery; returns false if another process won the race (PK conflict). */
function recordSent(key: string): boolean {
  const res = db
    .prepare("INSERT OR IGNORE INTO notifications_log (kind, key, sent_at) VALUES (?, ?, ?)")
    .run(DIGEST_KIND, key, new Date().toISOString());
  return res.changes > 0;
}

export interface DigestSendResult {
  status: "sent" | "skipped" | "failed";
  /** Why it was skipped/failed — surfaced to the admin, logged by the scheduler. */
  reason?: string;
  date?: string;
  text?: string;
}

/**
 * Builds and posts one day's digest to Slack. Idempotent by (kind, date):
 * the ledger row is claimed BEFORE posting, so a duplicate tick or a second
 * replica bails instead of double-posting. `force` re-posts a date that was
 * already sent (the admin's "Send to Slack now" button) and skips the
 * ledger claim.
 *
 * Quiet days are skipped by default — no "nobody logged anything" noise on
 * weekends — unless the caller forces the send.
 */
export async function sendDailyDigest(
  date: string,
  opts: { force?: boolean; tz?: string } = {}
): Promise<DigestSendResult> {
  if (!slackEnabled()) return { status: "skipped", reason: "slack not configured", date };

  const force = opts.force === true;
  if (!force && alreadySent(date)) return { status: "skipped", reason: "already sent", date };

  const digest = buildDailyDigest(date, opts.tz ?? digestTimeZone());
  if (!force && digest.members.length === 0) {
    // Claim the day anyway so a later tick doesn't re-evaluate it all day.
    recordSent(date);
    return { status: "skipped", reason: "no hours logged", date };
  }

  const text = renderDigestSlackText(digest, { tasks: process.env.OPENTIME_DIGEST_TASKS !== "0" });

  // Claim first: losing the race means another process is posting this one.
  if (!force && !recordSent(date)) return { status: "skipped", reason: "already sent", date };

  const error = await postSlackMessage(process.env.SLACK_DIGEST_CHANNEL ?? "", text);
  if (error) {
    // Release the claim so the next tick can retry a transient failure.
    if (!force) db.prepare("DELETE FROM notifications_log WHERE kind = ? AND key = ?").run(DIGEST_KIND, date);
    return { status: "failed", reason: error, date, text };
  }
  if (force) recordSent(date);
  return { status: "sent", date, text };
}

/**
 * Scheduler entry point: posts yesterday's digest once the configured local
 * hour has arrived (default 09:00 in OPENTIME_TZ). Safe to call hourly — the
 * ledger makes repeats no-ops, and a missed window still fires later the
 * same day.
 */
export async function runScheduledDigest(now: Date = new Date()): Promise<DigestSendResult> {
  if (!slackEnabled()) return { status: "skipped", reason: "slack not configured" };
  const tz = digestTimeZone();
  const sendHour = Number(process.env.OPENTIME_DIGEST_HOUR ?? 9);
  if (hourInZone(now, tz) < sendHour) return { status: "skipped", reason: "before send hour" };
  return sendDailyDigest(digestTargetDate(now, tz), { tz });
}
