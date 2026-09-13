import crypto from "crypto";
import { queries } from "@/lib/db";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email";

function required(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not configured`);
	return value;
}

function encryptionKey() {
	const key = Buffer.from(required("GMAIL_TOKEN_ENCRYPTION_KEY"), "base64");
	if (key.length !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64 32-byte key");
	return key;
}

export function encryptToken(token: string) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
	const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
	return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptToken(value: string) {
	const [ivText, tagText, encryptedText] = value.split(".");
	if (!ivText || !tagText || !encryptedText) throw new Error("Stored Gmail token is invalid");
	const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
	decipher.setAuthTag(Buffer.from(tagText, "base64url"));
	return Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8");
}

export function gmailAuthorizationUrl(state: string) {
	const params = new URLSearchParams({
		client_id: required("GOOGLE_GMAIL_CLIENT_ID"),
		redirect_uri: required("GOOGLE_GMAIL_REDIRECT_URI"),
		response_type: "code",
		scope: SCOPE,
		access_type: "offline",
		prompt: "consent",
		state,
	});
	return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeAuthorizationCode(code: string) {
	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: required("GOOGLE_GMAIL_CLIENT_ID"),
			client_secret: required("GOOGLE_GMAIL_CLIENT_SECRET"),
			redirect_uri: required("GOOGLE_GMAIL_REDIRECT_URI"),
			grant_type: "authorization_code",
		}),
	});
	const body = await response.json();
	if (!response.ok || !body.refresh_token) throw new Error(body.error_description ?? "Google did not return a refresh token");
	return body as { access_token: string; refresh_token: string };
}

async function accessToken() {
	const connection = queries.getGmailConnection.get() as { encryptedRefreshToken: string } | undefined;
	if (!connection) throw new Error("Gmail is not connected");
	const response = await fetch(GOOGLE_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: required("GOOGLE_GMAIL_CLIENT_ID"),
			client_secret: required("GOOGLE_GMAIL_CLIENT_SECRET"),
			refresh_token: decryptToken(connection.encryptedRefreshToken),
			grant_type: "refresh_token",
		}),
	});
	const body = await response.json();
	if (!response.ok) throw new Error(body.error_description ?? "Unable to refresh Gmail access");
	return body.access_token as string;
}

async function gmailFetch(path: string) {
	const token = await accessToken();
	const response = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
	if (!response.ok) throw new Error(`Gmail API request failed (${response.status})`);
	return response.json();
}

function header(headers: { name: string; value: string }[] | undefined, name: string) {
	return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function decode(data: string) {
	return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function bodyText(part: any): string {
	if (part.body?.data) return decode(part.body.data);
	return (part.parts ?? []).map(bodyText).join("\n");
}

export interface ParsedReceipt {
	gmailMessageId: string;
	senderName: string;
	amount: number;
	transferDate: string;
	receivedAt: string;
	subject: string;
}

export function parseInteracReceipt(message: any): ParsedReceipt | null {
	const from = header(message.payload?.headers, "From");
	const subject = header(message.payload?.headers, "Subject");
	// Gmail filters provide the first gate; this second gate keeps spoofed or unrelated
	// labelled mail out of the payment database.
	if (!/@(?:.*\.)?interac\.ca[>\s]/i.test(from) || !/interac\s+e-?transfer/i.test(subject)) return null;
	const text = `${subject}\n${bodyText(message.payload)}`.replace(/\s+/g, " ");
	const amountMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
	const senderMatch =
		text.match(/(?:from|sent by)\s*[:\-]?\s*([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})/i) ??
		text.match(/([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})\s+sent you/i);
	if (!amountMatch || !senderMatch) return null;
	const amount = Number(amountMatch[1].replace(/,/g, ""));
	if (!Number.isFinite(amount) || amount <= 0) return null;
	const receivedAt = new Date(Number(message.internalDate)).toISOString();
	return {
		gmailMessageId: message.id,
		senderName: senderMatch[1].trim(),
		amount,
		transferDate: receivedAt.slice(0, 10),
		receivedAt,
		subject,
	};
}

export async function importGmailReceipts() {
	const earliest = queries.getEarliestRunDate.get() as { startDate: string | null } | undefined;
	if (!earliest?.startDate) throw new Error("Add at least one dated run before importing Gmail receipts");
	const labelName = process.env.GMAIL_ETRANSFER_LABEL ?? "Vball Payments";
	const labels = await gmailFetch("/labels");
	const label = labels.labels?.find((l: { name: string }) => l.name === labelName);
	if (!label) throw new Error(`Gmail label “${labelName}” was not found`);
	let pageToken = "";
	let imported = 0;
	do {
		const query = new URLSearchParams({ labelIds: label.id, q: `after:${earliest.startDate}`, maxResults: "100", ...(pageToken ? { pageToken } : {}) });
		const list = await gmailFetch(`/messages?${query}`);
		for (const item of list.messages ?? []) {
			const message = await gmailFetch(`/messages/${item.id}?format=full`);
			const parsed = parseInteracReceipt(message);
			if (parsed) {
				const result = queries.insertGmailReceipt.run(parsed);
				imported += result.changes;
			}
		}
		pageToken = list.nextPageToken ?? "";
	} while (pageToken);
	return { imported };
}
