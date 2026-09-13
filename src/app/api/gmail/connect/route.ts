import crypto from "crypto";
import { NextResponse } from "next/server";
import { queries } from "@/lib/db";
import { gmailAuthorizationUrl } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		queries.deleteExpiredGmailOauthStates.run();
		const state = crypto.randomBytes(32).toString("base64url");
		queries.insertGmailOauthState.run(state);
		return NextResponse.redirect(gmailAuthorizationUrl(state));
	} catch (error) {
		return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to begin Gmail connection" }, { status: 500 });
	}
}
