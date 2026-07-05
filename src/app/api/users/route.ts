import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createUser, listUsers } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    return NextResponse.json({ data: listUsers() });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const body = await req.json();
    const user = createUser({
      name: body?.name,
      email: body?.email,
      password: body?.password,
      role: "member",
      project: body?.project,
    });
    return NextResponse.json({ data: user }, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
