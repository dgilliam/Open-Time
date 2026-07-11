import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { startTimer, taskRecordedSecs } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = requireUser(req);
    const body = await req.json();
    const entry = startTimer({ userId: user.id, task: body?.task });
    // Same augmentation as GET /api/timer: the timer UI continues a resumed
    // task from its recorded total instead of 0:00:00 (v3.2.1).
    const data = { ...entry, taskRecordedSecs: taskRecordedSecs(user.id, entry.taskId) };
    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
