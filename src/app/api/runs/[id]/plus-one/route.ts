export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { queries, removeSinglePlusOne } from "@/lib/db";

export async function POST(
	request: Request,
	{ params }: { params: { id: string } },
): Promise<NextResponse> {
	const body = (await request.json()) as { hostUserId?: string };
	const { hostUserId } = body;
	if (!hostUserId) {
		return NextResponse.json({ error: "hostUserId required" }, { status: 400 });
	}

	const row = queries.countPlusOnesForHost.get(hostUserId, params.id) as {
		count: number;
	};
	const plusOneUserId = `${hostUserId}__plus1__${params.id}__${row.count}`;

	queries.upsertAnonPlusOnePlayer.run({ userId: plusOneUserId });
	queries.upsertAttendancePlusOne.run({
		eventId: params.id,
		userId: plusOneUserId,
		rsvpStatus: "GOING",
		plusOneOf: hostUserId,
	});

	const goingRow = queries.getGoingCount.get(params.id) as { count: number };
	queries.updateSplitCount.run(goingRow.count, params.id);

	const run = queries.getRunBasic.get(params.id) as {
		totalCost: number | null;
		splitCount: number | null;
	} | null;
	if (run?.totalCost != null) {
		const amount = run.totalCost / goingRow.count;
		const going = queries.getGoingAttendance.all(params.id) as {
			userId: string;
		}[];
		for (const a of going) {
			queries.upsertPaymentOwed.run({
				eventId: params.id,
				userId: a.userId,
				amount,
			});
		}
	}

	return NextResponse.json({ plusOneUserId });
}

export async function DELETE(
	request: Request,
	{ params }: { params: { id: string } },
): Promise<NextResponse> {
	const body = (await request.json()) as { plusOneUserId?: string };
	const { plusOneUserId } = body;
	if (!plusOneUserId) {
		return NextResponse.json(
			{ error: "plusOneUserId required" },
			{ status: 400 },
		);
	}

	removeSinglePlusOne(params.id, plusOneUserId);

	const goingRow = queries.getGoingCount.get(params.id) as { count: number };
	queries.updateSplitCount.run(goingRow.count, params.id);

	const run = queries.getRunBasic.get(params.id) as {
		totalCost: number | null;
		splitCount: number | null;
	} | null;
	if (run?.totalCost != null && goingRow.count > 0) {
		const amount = run.totalCost / goingRow.count;
		const going = queries.getGoingAttendance.all(params.id) as {
			userId: string;
		}[];
		for (const a of going) {
			queries.upsertPaymentOwed.run({
				eventId: params.id,
				userId: a.userId,
				amount,
			});
		}
	}

	return NextResponse.json({ removed: true });
}
