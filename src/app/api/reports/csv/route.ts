import { NextRequest, NextResponse } from "next/server";
import { entriesForCsv } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const from = params.get("from") ?? undefined;
    const to = params.get("to") ?? undefined;
    const entries = entriesForCsv({ from, to });

    const header = ["date", "user", "project", "note", "started_at", "stopped_at", "hours"];
    const lines = [header.join(",")];

    for (const entry of entries) {
      const date = entry.startedAt.slice(0, 10);
      const hours = entry.stoppedAt
        ? (
            (new Date(entry.stoppedAt).getTime() - new Date(entry.startedAt).getTime()) /
            3_600_000
          ).toFixed(2)
        : "";
      lines.push(
        [
          date,
          entry.userName,
          entry.projectName,
          entry.note,
          entry.startedAt,
          entry.stoppedAt ?? "",
          hours,
        ]
          .map((v) => csvEscape(String(v)))
          .join(",")
      );
    }

    const csv = lines.join("\n") + "\n";

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="report.csv"',
      },
    });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
