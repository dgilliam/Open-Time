import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { stopTimer } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = requireUser(req);
    const entry = stopTimer({ userId: user.id });
    return NextResponse.json({ data: entry });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
