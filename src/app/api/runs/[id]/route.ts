import { NextResponse } from "next/server";
import { queries } from "@/lib/db";

export async function GET(
	_req: Request,
	{ params }: { params: { id: string } },
) {
	const rows = queries.getRunWithGuests.all(params.id) as any[];
	if (!rows.length)
		return NextResponse.json({ error: "Run not found" }, { status: 404 });

	const r0 = rows[0];
	const splitCount = r0.splitCount ?? 12;
	const costPerHead =
		r0.totalCost != null ? r0.totalCost / splitCount : (r0.costPerHead ?? null);

	const priorBalances = new Map<string, number>(
		(
			queries.getPlayerBalancesExcludingRun.all(params.id) as {
				userId: string;
				balance: number;
			}[]
		).map((b) => [b.userId, b.balance]),
	);

	const run = {
		eventId: r0.eventId,
		title: r0.title,
		startDate: r0.startDate,
		capacity: r0.capacity,
		totalCost: r0.totalCost,
		splitCount,
		costPerHead,
		notes: r0.notes,
		syncedAt: r0.syncedAt,
		hostUserId: r0.hostUserId ?? null,
		guests: rows
			.filter((r) => r.userId)
			.map((r) => ({
				userId: r.userId,
				name: r.displayName ?? r.name,
				partifulName: r.name,
				rsvpStatus: r.rsvpStatus,
				priorBalance: priorBalances.get(r.userId) ?? 0,
				payment: {
					amount: r.amount,
					amountPaid: r.amountPaid,
					paid: r.amountPaid != null || Boolean(r.paid),
					method: r.method,
					note: r.note,
				},
			})),
	};

	return NextResponse.json(run);
}

export async function PATCH(
	req: Request,
	{ params }: { params: { id: string } },
) {
	const body = await req.json();

	if (body.title) {
		queries.upsertRun.run({
			eventId: params.id,
			title: body.title,
			startDate: body.startDate ?? null,
		});
	}
	if (body.totalCost !== undefined || body.splitCount !== undefined) {
		const newTotalCost: number | null = body.totalCost ?? null;
		const newSplitCount: number = body.splitCount ?? 12;
		queries.updateRunCost.run({
			eventId: params.id,
			totalCost: newTotalCost,
			splitCount: newSplitCount,
		});
		const run = queries.getRunBasic.get(params.id) as any;
		const runHasHappened =
			run?.startDate != null && run.startDate <= new Date().toISOString();
		if (runHasHappened && newTotalCost != null && newTotalCost > 0) {
			const amountOwed = newTotalCost / newSplitCount;
			const going = queries.getGoingAttendance.all(params.id) as {
				userId: string;
			}[];
			for (const a of going) {
				queries.upsertPaymentOwed.run({
					eventId: params.id,
					userId: a.userId,
					amount: amountOwed,
				});
			}
			if (run?.hostUserId) {
				queries.markHostPaid.run({
					amount: amountOwed,
					amountPaid: amountOwed,
					eventId: params.id,
					userId: run.hostUserId,
				});
			}
			// Auto-apply credit for non-host players with sufficient prior balance
			for (const a of going) {
				if (a.userId === run?.hostUserId) continue;
				const row = queries.getPlayerBalanceExcludingRun.get(
					a.userId,
					params.id,
				) as { balance: number };
				if (row.balance >= amountOwed) {
					queries.markHostPaid.run({
						amount: amountOwed,
						amountPaid: amountOwed,
						eventId: params.id,
						userId: a.userId,
					});
				}
			}
		}
	}
	if (body.notes !== undefined) {
		queries.updateRunNotes.run({ eventId: params.id, notes: body.notes });
	}
	if ("hostUserId" in body) {
		const current = queries.getRunBasic.get(params.id) as any;
		const oldHostId: string | null = current?.hostUserId ?? null;
		const newHostId: string | null = body.hostUserId ?? null;

		queries.updateRunHost.run({ hostUserId: newHostId, eventId: params.id });

		if (newHostId && current?.totalCost != null && current.totalCost > 0) {
			const costPerHead = current.totalCost / (current.splitCount ?? 12);
			queries.markHostPaid.run({
				amount: costPerHead,
				amountPaid: costPerHead,
				eventId: params.id,
				userId: newHostId,
			});
		}
		if (oldHostId && oldHostId !== newHostId) {
			queries.clearHostPayment.run(params.id, oldHostId);
		}
	}

	return NextResponse.json({ ok: true });
}
