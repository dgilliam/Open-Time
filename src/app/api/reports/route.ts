import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { report } from "@/lib/repo";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = requireUser(req);
    const params = req.nextUrl.searchParams;
    const from = params.get("from") ?? undefined;
    const to = params.get("to") ?? undefined;
    const groupByParam = params.get("groupBy") ?? "task";
    if (groupByParam !== "task" && groupByParam !== "user") {
      throw new ApiError(400, "groupBy must be 'task' or 'user'");
    }

    if (groupByParam === "user") {
      // groupBy=user is an admin-only cross-team overview.
      if (user.role !== "admin") throw new ApiError(403, "admin only");
      const result = report({ from, to, groupBy: "user" });
      return NextResponse.json({ data: result });
    }

    const targetUserId = params.get("userId") ?? user.id;
    if (targetUserId !== user.id && user.role !== "admin") {
      throw new ApiError(403, "forbidden");
    }
    const result = report({ userId: targetUserId, from, to, groupBy: "task" });
    return NextResponse.json({ data: result });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
