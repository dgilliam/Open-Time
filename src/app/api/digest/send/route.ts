import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sendDailyDigest } from "@/lib/digest";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Admin-only manual send (v3.9): posts a given day's digest to the
 * configured Slack channel right now. Always forced — the admin asked for
 * it explicitly, so an already-sent day re-posts rather than silently doing
 * nothing. The scheduled path (runScheduledDigest) is the idempotent one.
 */
export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const date = String(body?.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, "date must be in YYYY-MM-DD format");
    }
    const result = await sendDailyDigest(date, { force: true });
    if (result.status === "failed") {
      throw new ApiError(502, `Slack rejected the message: ${result.reason}`);
    }
    if (result.status === "skipped") {
      throw new ApiError(400, result.reason ?? "nothing to send");
    }
    return NextResponse.json({ data: { status: result.status, date: result.date } });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
