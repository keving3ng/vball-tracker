export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { queries, upsertPaymentWithAudit } from "@/lib/db";

export async function GET() {
	const rows = queries.getUnpaidRunsForReconcile.all() as {
		userId: string;
		name: string;
		displayName: string | null;
		eventId: string;
		title: string;
		startDate: string;
		amountOwed: number;
	}[];

	const p1Rows = queries.getUnpaidPlusOnesForReconcile.all() as {
		hostUserId: string;
		plusOneUserId: string;
		eventId: string;
		title: string;
		startDate: string;
		amountOwed: number;
	}[];

	// Build player map keyed by userId
	const playerMap = new Map<
		string,
		{
			userId: string;
			name: string;
			displayName: string | null;
			unpaidRuns: {
				eventId: string;
				title: string;
				startDate: string;
				amountOwed: number;
				plusOneUserId: string | null;
			}[];
		}
	>();

	for (const row of rows) {
		if (!playerMap.has(row.userId)) {
			playerMap.set(row.userId, {
				userId: row.userId,
				name: row.name,
				displayName: row.displayName,
				unpaidRuns: [],
			});
		}
		playerMap.get(row.userId)!.unpaidRuns.push({
			eventId: row.eventId,
			title: row.title,
			startDate: row.startDate,
			amountOwed: row.amountOwed,
			plusOneUserId: null,
		});
	}

	// Append +1 entries under each host
	for (const row of p1Rows) {
		if (!playerMap.has(row.hostUserId)) continue;
		playerMap.get(row.hostUserId)!.unpaidRuns.push({
			eventId: row.eventId,
			title: row.title,
			startDate: row.startDate,
			amountOwed: row.amountOwed,
			plusOneUserId: row.plusOneUserId,
		});
	}

	// Sort each player's runs by startDate DESC
	for (const player of playerMap.values()) {
		player.unpaidRuns.sort((a, b) => b.startDate.localeCompare(a.startDate));
	}

	return NextResponse.json({ players: [...playerMap.values()] });
}

export async function POST(req: Request) {
	const { payments } = (await req.json()) as {
		payments: {
			userId: string;
			eventId: string;
			amountOwed: number;
		}[];
	};

	for (const p of payments) {
		upsertPaymentWithAudit({
			eventId: p.eventId,
			userId: p.userId,
			amount: p.amountOwed,
			amountPaid: p.amountOwed,
			paid: 1,
			method: null,
			note: "reconciled",
			action: "marked_paid",
		});
	}

	return NextResponse.json({ ok: true, count: payments.length });
}
