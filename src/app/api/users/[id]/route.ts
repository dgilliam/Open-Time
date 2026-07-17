import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { removeUser, restoreUser, updateUser } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * `{restore: true}` brings a soft-removed member back (v2.7); otherwise a
 * name/project patch, optionally with a `password` reset (v3.4 — resets the
 * member's login and signs out their existing sessions).
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await context.params;
    const body = await req.json();
    if (body?.restore === true) {
      const user = restoreUser(id);
      return NextResponse.json({ data: user });
    }
    const user = updateUser(
      id,
      {
        name: body?.name,
        project: body?.project,
        password: typeof body?.password === "string" && body.password.length > 0 ? body.password : undefined,
      },
      admin.id
    );
    return NextResponse.json({ data: user });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}

/** Soft-removes a member (admin only, v2.7); 400 when targeting yourself. */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const admin = requireAdmin(req);
    const { id } = await context.params;
    const user = removeUser(id, admin.id);
    return NextResponse.json({ data: user });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
