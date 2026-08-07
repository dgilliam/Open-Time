import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { buildDailyDigest, renderDigestSlackText } from "@/lib/digest";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Admin-only preview of the daily digest (v3.9 prototype): builds the
 * digest for ?date=YYYY-MM-DD in ?tz= (viewer's zone) and returns both the
 * structured data and the exact Slack text a future scheduler would post.
 * Sends nothing.
 */
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const params = req.nextUrl.searchParams;
    const date = params.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, "date must be in YYYY-MM-DD format");
    }
    const tz = params.get("tz") ?? undefined;
    const digest = buildDailyDigest(date, tz);
    return NextResponse.json({ data: { digest, slackText: renderDigestSlackText(digest) } });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
