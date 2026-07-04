import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listTasksForUser } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser(req);
    const q = req.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json({ data: listTasksForUser(user.id, q) });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
