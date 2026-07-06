import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { invoicePeriodDetail, setInvoicePeriodLocked } from "@/lib/invoices";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Admin only: per-member summary + per-member/per-task detail rows for one period. */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await context.params;
    const detail = invoicePeriodDetail(id);
    return NextResponse.json({ data: detail });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}

/** Admin only: `{locked: boolean}` — lock/unlock a period. Unlocking never detaches its entries. */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await context.params;
    const body = await req.json();
    const period = setInvoicePeriodLocked(id, !!body?.locked);
    return NextResponse.json({ data: period });
  } catch (err) {
    const { status, body: errBody } = apiErrorResponse(err);
    return NextResponse.json(errBody, { status });
  }
}
