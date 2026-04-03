export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUpcomingEvents, getPastEvents } from "@keg/partiful-api";
import { queries } from "@/lib/db";

const VBALL_RE = /vball|volley|🏐/i;

function isVballEvent(event: { title?: string }) {
	return VBALL_RE.test(event.title ?? "");
}

export async function GET() {
	const [upcoming, past] = await Promise.all([
		getUpcomingEvents(),
		getPastEvents(),
	]);
	const manualRuns = (
		queries.getManualRuns.all() as {
			eventId: string;
			title: string;
			startDate: string | null;
		}[]
	).map((r) => ({
		id: r.eventId,
		title: r.title,
		startDate: r.startDate,
		status: "manual",
	}));

	const now = new Date().toISOString();
	const upcomingManual = manualRuns.filter(
		(r) => !r.startDate || r.startDate >= now,
	);
	const pastManual = manualRuns.filter((r) => r.startDate && r.startDate < now);

	return NextResponse.json({
		upcoming: [
			...(upcoming.result.data.upcomingEvents ?? []).filter(isVballEvent),
			...upcomingManual,
		],
		past: [
			...(past.result.data.pastEvents ?? []).filter(isVballEvent),
			...pastManual,
		],
	});
}

export async function POST(request: Request): Promise<NextResponse> {
	const body = (await request.json()) as { title?: string; startDate?: string };
	const { title, startDate } = body;
	if (!title?.trim()) {
		return NextResponse.json({ error: "title is required" }, { status: 400 });
	}
	const eventId = `manual-${Date.now()}`;
	queries.insertManualRun.run({
		eventId,
		title: title.trim(),
		startDate: startDate ?? null,
	});
	return NextResponse.json({
		id: eventId,
		title: title.trim(),
		startDate: startDate ?? null,
		status: "manual",
	});
}
