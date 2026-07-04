import { NextRequest, NextResponse } from "next/server";
import { stopTimer } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entry = stopTimer({ userId: body?.userId });
    return NextResponse.json({ data: entry });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
