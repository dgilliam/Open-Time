import { NextRequest, NextResponse } from "next/server";
import { assertSelfOrAdmin, requireUser } from "@/lib/auth";
import { setTimesheetCell } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// Optional `userId` (v3.14): the same self-or-admin rule as POST /api/entries
// (v3.3), so an admin can fill a member's timesheet from the view-as-member
// mode on the Time entry page. Members can only pass their own id. The
// acting user is still the caller — that's what the lock check keys on, so
// an admin editing a member's cell bypasses invoice locks exactly as they do
// in the entry dialog.
export async function PUT(req: NextRequest) {
  try {
    const user = requireUser(req);
    const body = await req.json();
    const targetUserId = typeof body?.userId === "string" && body.userId ? body.userId : user.id;
    assertSelfOrAdmin(user, targetUserId);
    const result = setTimesheetCell({
      userId: targetUserId,
      task: body?.task,
      date: body?.date,
      hours: body?.hours,
      tz: typeof body?.tz === "string" ? body.tz : undefined,
      actingUser: user,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
