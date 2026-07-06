import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { currentUninvoiced, listInvoicePeriods } from "@/lib/invoices";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Admin only: periods desc (each with totalHours/memberCount) plus `current`, the live uninvoiced-so-far preview. */
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const periods = listInvoicePeriods();
    const current = currentUninvoiced();
    return NextResponse.json({ data: { periods, current } });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
