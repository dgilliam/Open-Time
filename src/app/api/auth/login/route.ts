import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie, verifyPassword } from "@/lib/auth";
import { getUserAuthByEmail } from "@/lib/repo";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = String(body?.email ?? "").trim();
    const password = String(body?.password ?? "");
    if (!email || !password) throw new ApiError(400, "email and password are required");

    const userAuth = getUserAuthByEmail(email);
    if (!userAuth || !verifyPassword(password, userAuth.passwordHash)) {
      throw new ApiError(401, "invalid email or password");
    }

    const { passwordHash: _passwordHash, ...user } = userAuth;
    const res = NextResponse.json({ data: user });
    const { token } = createSession(user.id);
    setSessionCookie(res, token);
    return res;
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
