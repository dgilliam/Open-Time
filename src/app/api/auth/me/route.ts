import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = getSessionUser(token);
    return NextResponse.json({ data: user ?? null });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
