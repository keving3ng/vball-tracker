import { NextResponse } from "next/server";
import { queries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json({ receipts: queries.getGmailReceipts.all() });
}
