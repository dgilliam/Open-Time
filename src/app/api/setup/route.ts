import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { countUsers, createUser } from "@/lib/repo";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ data: { needed: countUsers() === 0 } });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (countUsers() > 0) throw new ApiError(409, "setup already completed");
    const body = await req.json();
    const user = createUser({
      name: body?.name,
      email: body?.email,
      password: body?.password,
      role: "admin",
    });
    const res = NextResponse.json({ data: user }, { status: 201 });
    const { token } = createSession(user.id);
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
