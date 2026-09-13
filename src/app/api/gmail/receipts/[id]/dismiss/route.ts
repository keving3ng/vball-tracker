import { NextResponse } from "next/server";
import { queries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
	const receipt = queries.getGmailReceipt.get(Number(params.id)) as { status: string } | undefined;
	if (!receipt || receipt.status === "applied") return NextResponse.json({ error: "Receipt is unavailable" }, { status: 404 });
	queries.updateGmailReceiptAllocationState.run({ id: Number(params.id), unallocatedAmount: 0, status: "dismissed" });
	return NextResponse.json({ ok: true });
}
