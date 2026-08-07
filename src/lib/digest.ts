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
