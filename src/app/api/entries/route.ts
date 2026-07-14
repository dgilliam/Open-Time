import { NextRequest, NextResponse } from "next/server";
import { assertSelfOrAdmin, requireUser } from "@/lib/auth";
import { createEntry, listEntries } from "@/lib/repo";
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
    return NextResponse.json({ data: listEntries({ userId: targetUserId, from, to }) });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireUser(req);
    const body = await req.json();
    // Optional userId lets the admin backfill hours for a member (v3.3, same
    // self-or-admin rule as GET above and as entry PUT/DELETE). Members can
    // only pass their own id.
    const targetUserId = body?.userId ?? user.id;
    assertSelfOrAdmin(user, targetUserId);
    const entry = createEntry({
      userId: targetUserId,
      task: body?.task,
      startedAt: body?.startedAt,
      stoppedAt: body?.stoppedAt,
    });
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
