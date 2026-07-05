import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { updateUser } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    requireAdmin(req);
    const { id } = await context.params;
    const body = await req.json();
    const user = updateUser(id, {
      name: body?.name,
      project: body?.project,
    });
    return NextResponse.json({ data: user });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
