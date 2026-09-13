import { NextResponse } from "next/server";
import { importGmailReceipts } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const expected = process.env.GMAIL_SYNC_SECRET;
	if (!expected || request.headers.get("x-gmail-sync-secret") !== expected)
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		return NextResponse.json({ ok: true, ...(await importGmailReceipts()) });
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Gmail import failed" }, { status: 500 });
	}
}
