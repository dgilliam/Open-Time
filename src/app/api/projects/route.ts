import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";
    return NextResponse.json({ data: listProjects({ includeArchived }) });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const project = createProject({
      name: body?.name,
      client: body?.client,
      color: body?.color,
      hourlyRateCents: body?.hourlyRateCents,
    });
    return NextResponse.json({ data: project }, { status: 201 });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
