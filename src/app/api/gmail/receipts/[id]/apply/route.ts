import { NextResponse } from "next/server";
import { applyGmailReceiptAllocations, type GmailReceiptAllocation } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
	const body = await request.json();
	if (!Array.isArray(body.allocations)) return NextResponse.json({ error: "allocations are required" }, { status: 400 });
	try {
		applyGmailReceiptAllocations(Number(params.id), body.allocations as GmailReceiptAllocation[]);
		return NextResponse.json({ ok: true });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to apply receipt" }, { status: 400 });
	}
}
