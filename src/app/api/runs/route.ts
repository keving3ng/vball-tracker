export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUpcomingEvents, getPastEvents } from "@keg/partiful-api";
import { queries } from "@/lib/db";

const VBALL_RE = /vball|volley|🏐/i;

function isVballEvent(event: { title?: string }) {
	return VBALL_RE.test(event.title ?? "");
}

interface PartifulEventRaw {
	id: string;
	title: string;
	startDate: string | null;
	status: string;
}

interface EnrichedEvent extends PartifulEventRaw {
	displayTitle: string | null;
	paidCount: number;
	totalCount: number;
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

	// Build enrichment maps from local DB
	const displayTitleRows = queries.getRunDisplayTitles.all() as {
		eventId: string;
		displayTitle: string | null;
	}[];
	const displayTitleMap = new Map(
		displayTitleRows.map((r) => [r.eventId, r.displayTitle]),
	);

	const paymentSummaryRows = queries.getPaymentSummaries.all() as {
		eventId: string;
		paidCount: number;
		totalCount: number;
	}[];
	const paymentMap = new Map(paymentSummaryRows.map((s) => [s.eventId, s]));

	const enrich = (event: PartifulEventRaw): EnrichedEvent => ({
		...event,
		displayTitle: displayTitleMap.get(event.id) ?? null,
		paidCount: paymentMap.get(event.id)?.paidCount ?? 0,
		totalCount: paymentMap.get(event.id)?.totalCount ?? 0,
	});

	return NextResponse.json({
		upcoming: [
			...(upcoming.result.data.upcomingEvents ?? [])
				.filter(isVballEvent)
				.map(enrich),
			...upcomingManual.map(enrich),
		],
		past: [
			...(past.result.data.pastEvents ?? []).filter(isVballEvent).map(enrich),
			...pastManual.map(enrich),
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
		displayTitle: null,
		startDate: startDate ?? null,
		status: "manual",
		paidCount: 0,
		totalCount: 0,
	});
}
