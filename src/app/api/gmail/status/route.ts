import { NextResponse } from "next/server";
import { queries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
	const row = queries.getGmailConnection.get() as { email: string; connectedAt: string } | undefined;
	return NextResponse.json({ connected: Boolean(row), email: row?.email ?? null, connectedAt: row?.connectedAt ?? null, label: process.env.GMAIL_ETRANSFER_LABEL ?? "Vball Payments" });
}

export async function DELETE() {
	queries.deleteGmailConnection.run();
	return NextResponse.json({ ok: true });
}
