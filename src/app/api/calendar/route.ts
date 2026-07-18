import { NextRequest, NextResponse } from "next/server";
import { assertSelfOrAdmin, requireUser } from "@/lib/auth";
import { calendarBuckets } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser(req);
    const params = req.nextUrl.searchParams;
    const targetUserId = params.get("userId") ?? user.id;
    assertSelfOrAdmin(user, targetUserId);

    const from = params.get("from") ?? undefined;
    const to = params.get("to") ?? undefined;
    return NextResponse.json({ data: calendarBuckets({ userId: targetUserId, from, to, tz: params.get("tz") ?? undefined }) });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
