import { NextResponse } from "next/server";
import { queries } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	const { senderName, userId } = await request.json();
	if (typeof senderName !== "string" || !senderName.trim() || typeof userId !== "string")
		return NextResponse.json({ error: "senderName and userId are required" }, { status: 400 });
	if (!queries.getPlayerBasic.get(userId)) return NextResponse.json({ error: "Unknown player" }, { status: 400 });
	queries.upsertGmailSenderMapping.run({ senderName: senderName.trim(), userId });
	return NextResponse.json({ ok: true });
}
