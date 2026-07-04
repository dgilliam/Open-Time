import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, deleteSession, SESSION_COOKIE } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    deleteSession(token);
    const res = NextResponse.json({ data: null });
    clearSessionCookie(res);
    return res;
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
