import { NextRequest, NextResponse } from "next/server";
import { assertSelfOrAdmin, requireUser } from "@/lib/auth";
import { listEntries, localDateKey, zoneDateKey } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const CSV_HEADER = "member,project,task,task_status,task_link,task_details,duration_hours,date";

/** Double-quotes a field if it contains a comma, quote, or newline, per RFC 4180. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Renders a from/to bound as YYYY-MM-DD for the filename, or "all" when absent. */
function filenameBound(iso: string | undefined): string {
  return iso ? localDateKey(iso) : "all";
}

export async function GET(req: NextRequest) {
  try {
    const user = requireUser(req);
    const params = req.nextUrl.searchParams;
    const targetUserId = params.get("userId") ?? user.id;
    assertSelfOrAdmin(user, targetUserId);

    const from = params.get("from") ?? undefined;
    // Viewer's IANA zone for the date column (v3.4.1); optional.
    const tz = params.get("tz") ?? undefined;
    const to = params.get("to") ?? undefined;

    // project: absent = off; "__none__" sentinel = unassigned members only
    // (JS null); any other value = that project label, exact match.
    const projectParam = params.get("project");
    const project = projectParam === null ? undefined : projectParam === "__none__" ? null : projectParam;

    const entries = listEntries({ userId: targetUserId, from, to, project }).filter(
      (e) => e.durationSecs !== null
    );

    const rows = entries
      .map((e) => ({
        member: e.userName,
        project: e.userProject ?? "",
        task: e.taskName,
        taskStatus: e.taskStatus,
        taskLink: e.taskLink ?? "",
        taskDetails: e.taskDetails ?? "",
        durationHours: (e.durationSecs as number) / 3600,
        date: zoneDateKey(e.startedAt, tz),
      }))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
      });

    const lines = [CSV_HEADER];
    for (const row of rows) {
      lines.push(
        [
          csvField(row.member),
          csvField(row.project),
          csvField(row.task),
          csvField(row.taskStatus),
          csvField(row.taskLink),
          csvField(row.taskDetails),
          String(row.durationHours),
          row.date,
        ].join(",")
      );
    }
    const csv = lines.join("\n") + "\n";

    const filename = `opentime_${filenameBound(from)}_${filenameBound(to)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
