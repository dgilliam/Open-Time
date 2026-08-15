import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";
import { db } from "@/lib/db";
import { createUser } from "@/lib/repo";
import { assertSetupAllowed, setupStatus } from "@/lib/setup";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ data: setupStatus() });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    // Body first, guard second: the check and the insert must not straddle an
    // await, or two concurrent requests can both pass an empty-table check
    // (security review 2026-08-15). Everything below this line is synchronous.
    const body = await req.json();
    const token = String(body?.token ?? "");

    const user = db.transaction(() => {
      assertSetupAllowed(token);
      return createUser({
        name: body?.name,
        email: body?.email,
        password: body?.password,
        role: "admin",
      });
    })();

    const res = NextResponse.json({ data: user }, { status: 201 });
    const { token: sessionToken } = createSession(user.id);
    setSessionCookie(res, sessionToken);
    return res;
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
