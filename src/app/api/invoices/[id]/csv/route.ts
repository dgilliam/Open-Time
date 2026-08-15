import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { csvField } from "@/lib/csv";
import { invoicePeriodDetail } from "@/lib/invoices";
import { apiErrorResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const CSV_HEADER = "engineer,bill_rate,hours";

/** Admin only: columns exactly engineer,bill_rate,hours — bill_rate is always empty (the founder fills rates). */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    requireAdmin(req);
    const { id } = await context.params;
    const detail = invoicePeriodDetail(id);

    const lines = [CSV_HEADER];
    for (const member of detail.members) {
      lines.push([csvField(member.name), "", String(member.hours)].join(","));
    }
    const csv = lines.join("\n") + "\n";

    const filename = `invoice_${detail.period.label}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const { status, body } = apiErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
