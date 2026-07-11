import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRunningEntry, taskRecordedSecs } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser(req);
    const entry = getRunningEntry(user.id);
    // taskRecordedSecs lets the timer UI continue a resumed task from its
    // recorded total instead of 0:00:00 (v3.2.1).
    const data = entry ? { ...entry, taskRecordedSecs: taskRecordedSecs(user.id, entry.taskId) } : null;
    return NextResponse.json({ data });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
