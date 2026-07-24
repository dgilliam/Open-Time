import { NextResponse } from "next/server";
import { googleEnabled } from "@/lib/google";

export const dynamic = "force-dynamic";

/**
 * Which sign-in methods are available (v3.6) — lets the login page show the
 * Google button only when the deployment actually has credentials
 * configured. Unauthenticated by design: it reveals nothing but the
 * existence of a login method.
 */
export async function GET() {
  return NextResponse.json({ data: { google: googleEnabled() } });
}
