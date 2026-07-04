import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { startTimer } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = requireUser(req);
    const body = await req.json();
    const entry = startTimer({ userId: user.id, task: body?.task });
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
