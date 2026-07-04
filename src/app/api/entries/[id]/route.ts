import { NextRequest, NextResponse } from "next/server";
import { assertSelfOrAdmin, requireUser } from "@/lib/auth";
import { deleteEntry, getEntry, updateEntry } from "@/lib/repo";
import { ApiError, apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = requireUser(req);
    const { id } = await context.params;
    const existing = getEntry(id);
    if (!existing) throw new ApiError(404, "entry not found");
    assertSelfOrAdmin(user, existing.userId);

    const body = await req.json();
    const entry = updateEntry(id, {
      task: body?.task,
      startedAt: body?.startedAt,
      stoppedAt: body?.stoppedAt,
    });
    return NextResponse.json({ data: entry });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = requireUser(req);
    const { id } = await context.params;
    const existing = getEntry(id);
    if (!existing) throw new ApiError(404, "entry not found");
    assertSelfOrAdmin(user, existing.userId);

    deleteEntry(id);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
