import { NextResponse } from "next/server";
import { queries } from "@/lib/db";
import { encryptToken, exchangeAuthorizationCode, importGmailReceipts } from "@/lib/gmail";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const fail = (message: string) => NextResponse.redirect(new URL(`/reconcile?gmailError=${encodeURIComponent(message)}`, request.url));
	if (!code || !state) return fail("Google did not return a complete authorization response");
	if (queries.consumeGmailOauthState.run(state).changes !== 1) return fail("This Gmail authorization link is invalid or expired");
	try {
		const token = await exchangeAuthorizationCode(code);
		const infoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
			headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store",
		});
		const info = await infoResponse.json();
		if (!infoResponse.ok || !info.email) throw new Error("Unable to identify the connected Gmail account");
		queries.upsertGmailConnection.run({ email: info.email, encryptedRefreshToken: encryptToken(token.refresh_token) });
		try { await importGmailReceipts(); } catch { /* scheduled sync will retry */ }
		return NextResponse.redirect(new URL("/reconcile?gmail=connected", request.url));
	} catch (error) {
		return fail(error instanceof Error ? error.message : "Unable to connect Gmail");
	}
}
