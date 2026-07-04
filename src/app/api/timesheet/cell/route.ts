import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { setTimesheetCell } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// Self only: no userId param, the caller can only edit their own timesheet.
export async function PUT(req: NextRequest) {
  try {
    const user = requireUser(req);
    const body = await req.json();
    const result = setTimesheetCell({
      userId: user.id,
      task: body?.task,
      date: body?.date,
      hours: body?.hours,
    });
    return NextResponse.json({ data: result });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
