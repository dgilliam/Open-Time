import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { latestBackupDate } from "@/lib/backup";
import { currentUninvoiced, listInvoicePeriods } from "@/lib/invoices";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Admin only: periods desc (each with totalHours/memberCount) plus `current`, the live uninvoiced-so-far preview. */
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const periods = listInvoicePeriods();
    const current = currentUninvoiced();
    const lastBackup = latestBackupDate();
    return NextResponse.json({ data: { periods, current, lastBackup } });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
