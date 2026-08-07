// Daily digest (v3.9 prototype): who logged hours yesterday, how many, on
// what. This module only BUILDS and RENDERS the digest — nothing here sends
// anything. The admin previews it on the Dashboard; the Slack delivery +
// scheduler come later, once the format is signed off (docs/PLAN.md).

import { listEntries, listUsers, zoneDateKey } from "./repo";

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

/**
 * Slack mrkdwn rendering — the exact text a future scheduler would post.
 * Kept dumb and deterministic so the Dashboard preview IS the contract.
 */
export function renderDigestSlackText(d: DailyDigest): string {
  const lines: string[] = [];
  lines.push(`:clock3: *Open-Time — ${friendlyDate(d.date)}*`);
  if (d.members.length === 0) {
    lines.push("_No hours logged._");
    return lines.join("\n");
  }
  lines.push(`*${d.members.length} logged · ${hoursLabel(d.totalHours)} total*`);
  lines.push("");
  for (const m of d.members) {
    const tasks = m.tasks.map((t) => `\`${t.task}\` ${hoursLabel(t.hours)}`).join(", ");
    lines.push(`• *${m.name}* — ${hoursLabel(m.hours)}: ${tasks}`);
  }
  if (d.noHours.length > 0) {
    lines.push("");
    lines.push(`_No hours: ${d.noHours.join(", ")}_`);
  }
  return lines.join("\n");
}
