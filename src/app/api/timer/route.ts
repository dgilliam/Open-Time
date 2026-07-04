import { NextRequest, NextResponse } from "next/server";
import { getRunningEntry } from "@/lib/repo";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) throw new ApiError(400, "userId is required");
    return NextResponse.json({ data: getRunningEntry(userId) });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
