export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { queries } from "@/lib/db";
import type { GlobalPaymentAuditLogRow } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
	const rows =
		queries.getGlobalPaymentAuditLog.all() as GlobalPaymentAuditLogRow[];
	return NextResponse.json(rows);
}
