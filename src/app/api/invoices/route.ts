import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { latestBackupDate } from "@/lib/backup";
import { currentUninvoiced, listInvoicePeriods, resweepLivePeriods } from "@/lib/invoices";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Admin only: periods desc (each with totalHours/memberCount) plus `current`, the live uninvoiced-so-far preview. */
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    // v3.8: live periods absorb backfills on page load, not just on the
    // hourly sweep, so the admin always sees current numbers.
    resweepLivePeriods();
    const periods = listInvoicePeriods();
    const current = currentUninvoiced();
    const lastBackup = latestBackupDate();
    return NextResponse.json({ data: { periods, current, lastBackup } });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
