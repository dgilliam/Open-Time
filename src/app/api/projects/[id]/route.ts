import { NextRequest, NextResponse } from "next/server";
import { updateProject } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await req.json();
    const project = updateProject(id, {
      name: body?.name,
      client: body?.client,
      color: body?.color,
      hourlyRateCents: body?.hourlyRateCents,
      archived: body?.archived,
    });
    return NextResponse.json({ data: project });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
