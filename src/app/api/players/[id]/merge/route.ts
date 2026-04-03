import { NextResponse } from "next/server";
import { queries, mergePlayerIntoTarget } from "@/lib/db";

export async function POST(
	req: Request,
	{ params }: { params: { id: string } },
): Promise<NextResponse> {
	if (!params.id.startsWith("manual-")) {
		return NextResponse.json(
			{ error: "Only manual players can be merged" },
			{ status: 400 },
		);
	}

	const body = (await req.json()) as { targetUserId?: string };
	if (!body.targetUserId) {
		return NextResponse.json(
			{ error: "targetUserId required" },
			{ status: 400 },
		);
	}

	const source = queries.getPlayerBasic.get(params.id);
	if (!source)
		return NextResponse.json({ error: "Player not found" }, { status: 404 });

	const target = queries.getPlayerBasic.get(body.targetUserId);
	if (!target)
		return NextResponse.json(
			{ error: "Target player not found" },
			{ status: 404 },
		);

	mergePlayerIntoTarget(params.id, body.targetUserId);

	return NextResponse.json({ ok: true, targetUserId: body.targetUserId });
}
