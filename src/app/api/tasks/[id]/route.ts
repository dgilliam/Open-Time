import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { updateTask } from "@/lib/repo";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

// PATCH /api/tasks/[id] — task wrap-up metadata (docs/PLAN.md v2.6 section
// B): {link?, details?, status?}. Authorization is enforced inside
// updateTask (admin, or any user with ≥1 entry on the task; 403 otherwise,
// 404 unknown task) — this route stays thin.
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = requireUser(req);
    const { id } = await context.params;
    const body = await req.json();
    const task = updateTask(
      id,
      { id: user.id, role: user.role },
      {
        link: body?.link,
        details: body?.details,
        status: body?.status,
      }
    );
    return NextResponse.json({ data: task });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
