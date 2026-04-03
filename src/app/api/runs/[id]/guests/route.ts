import { NextResponse } from "next/server";
import { queries } from "@/lib/db";

export async function POST(
	req: Request,
	{ params }: { params: { id: string } },
) {
	const body = (await req.json()) as { userId?: string; name?: string };

	let userId: string;

	if (body.userId) {
		const existing = queries.getPlayerBasic.get(body.userId) as
			| { userId: string }
			| undefined;
		if (!existing)
			return NextResponse.json({ error: "Player not found" }, { status: 404 });
		userId = body.userId;
	} else if (body.name?.trim()) {
		userId = `manual-${Date.now()}`;
		queries.upsertPlayer.run({ userId, name: body.name.trim() });
	} else {
		return NextResponse.json(
			{ error: "userId or name required" },
			{ status: 400 },
		);
	}

	queries.upsertAttendance.run({
		eventId: params.id,
		userId,
		rsvpStatus: "GOING",
	});

	const run = queries.getRunBasic.get(params.id) as
		| {
				totalCost: number | null;
				splitCount: number | null;
				startDate: string | null;
		  }
		| undefined;
	const runHasHappened =
		run?.startDate != null && run.startDate <= new Date().toISOString();
	if (runHasHappened && run?.totalCost != null) {
		const amount = run.totalCost / (run.splitCount ?? 12);
		queries.upsertPaymentOwed.run({ eventId: params.id, userId, amount });
	}

	return NextResponse.json({ ok: true, userId });
}
