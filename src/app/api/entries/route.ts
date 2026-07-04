import { NextRequest, NextResponse } from "next/server";
import { createEntry, listEntries } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const userId = params.get("userId") ?? undefined;
    const from = params.get("from") ?? undefined;
    const to = params.get("to") ?? undefined;
    return NextResponse.json({ data: listEntries({ userId, from, to }) });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entry = createEntry({
      userId: body?.userId,
      projectId: body?.projectId,
      note: body?.note,
      startedAt: body?.startedAt,
      stoppedAt: body?.stoppedAt,
    });
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
