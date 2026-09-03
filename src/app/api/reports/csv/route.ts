import { NextRequest, NextResponse } from "next/server";
import { assertSelfOrAdmin, requireUser } from "@/lib/auth";
import { csvField } from "@/lib/csv";
import { listEntries, localDateKey, zoneDateKey } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// The first eight columns are the original export and stay in place so
// existing spreadsheet formulas keep pointing at the right letters. The rest
// were added for reconciliation (v3.12): `date` is rendered in the
// DOWNLOADER's timezone, so two people exporting the same range get
// different dates and — because the from/to window is also viewer-local —
// can get different totals. entry_id is a stable join key across exports,
// and started_at_utc/stopped_at_utc are the one representation of the time
// that never moves. invoice_period says which week-ending invoice (if any)
// the row was billed on.
const CSV_HEADER = [
  "member",
  "project",
  "task",
  "task_status",
  "task_link",
  "task_details",
  "duration_hours",
  "date",
  "entry_id",
  "task_id",
  "started_at_utc",
  "stopped_at_utc",
  "invoice_period",
  "invoice_locked",
].join(",");

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
        entryId: e.id,
        taskId: e.taskId,
        startedAtUtc: e.startedAt,
        stoppedAtUtc: e.stoppedAt ?? "",
        invoicePeriod: e.invoicePeriodLabel ?? "",
        invoiceLocked: e.invoiceLocked ? "true" : "false",
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
          row.entryId,
          row.taskId,
          row.startedAtUtc,
          row.stoppedAtUtc,
          row.invoicePeriod,
          row.invoiceLocked,
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
