import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getRunningEntry } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser(req);
    return NextResponse.json({ data: getRunningEntry(user.id) });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
