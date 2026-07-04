import { NextRequest, NextResponse } from "next/server";
import { report } from "@/lib/repo";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const from = params.get("from") ?? undefined;
    const to = params.get("to") ?? undefined;
    const groupByParam = params.get("groupBy") ?? "project";
    if (groupByParam !== "project" && groupByParam !== "user") {
      throw new ApiError(400, "groupBy must be 'project' or 'user'");
    }
    const result = report({ from, to, groupBy: groupByParam });
    return NextResponse.json({ data: result });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
