import { NextResponse } from "next/server";
import { queries, PaymentAuditLogRow } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
	_req: Request,
	{ params }: { params: { id: string } },
) {
	const rows = queries.getPaymentAuditLog.all(
		params.id,
	) as PaymentAuditLogRow[];
	return NextResponse.json(rows);
}
