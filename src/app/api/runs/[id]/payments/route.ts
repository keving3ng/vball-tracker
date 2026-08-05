export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { upsertPaymentWithAudit } from "@/lib/db";

export async function POST(
	req: Request,
	{ params }: { params: { id: string } },
) {
	const body = await req.json();
	const { userId, amount, amountPaid, method, note } = body;

	const resolvedAmountPaid: number | null =
		amountPaid !== undefined ? amountPaid : null;

	const action = resolvedAmountPaid != null ? "marked_paid" : "marked_unpaid";

	upsertPaymentWithAudit({
		eventId: params.id,
		userId,
		amount: amount ?? 0,
		amountPaid: resolvedAmountPaid,
		paid: resolvedAmountPaid != null ? 1 : 0,
		method: method ?? null,
		note: note ?? null,
		action,
	});

	return NextResponse.json({ ok: true });
}
