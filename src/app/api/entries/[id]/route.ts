import { NextRequest, NextResponse } from "next/server";
import { deleteEntry, updateEntry } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const entry = updateEntry(id, {
      note: body?.note,
      projectId: body?.projectId,
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
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    deleteEntry(id);
    return NextResponse.json({ data: { id } });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
