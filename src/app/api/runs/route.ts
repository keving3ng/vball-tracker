export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUpcomingEvents, getPastEvents } from "@keg/partiful-api";
import { queries } from "@/lib/db";

const VBALL_RE = /vball|volley|🏐/i;
const KEVIN_PARTIFUL_USER_ID = "uFItaBptDMVmeXFHhw1Rhma8FOq1";

// Partiful's exact cancelled status string is unconfirmed (only PUBLISHED observed).
// Substring match covers CANCELLED / CANCELED / EVENT_CANCELLED.
const CANCELLED_RE = /cancel/i;

function isVballEvent(event: { title?: string; ownerIds?: string[] }) {
	return (
		VBALL_RE.test(event.title ?? "") &&
		(event.ownerIds ?? []).includes(KEVIN_PARTIFUL_USER_ID)
	);
}

function isCancelledEvent(event: { status?: string }) {
	return CANCELLED_RE.test(event.status ?? "");
}

interface PartifulEventRaw {
	id: string;
	title: string;
	startDate: string | null;
	status: string;
	ownerIds?: string[];
}

interface EnrichedEvent extends PartifulEventRaw {
	displayTitle: string | null;
	syncedAt: string | null;
	goingCount: number;
	paidCount: number;
	totalCount: number;
	isHosting: boolean;
}

// Partiful event lists change rarely but cost a token refresh + two API calls
// per fetch. Cache them in-process: fresh for TTL, stale copy served if Partiful
// errors, concurrent callers share one in-flight request. `?refresh=1` bypasses.
const PARTIFUL_CACHE_TTL_MS = 5 * 60 * 1000;

type PartifulLists = {
	upcoming: Awaited<ReturnType<typeof getUpcomingEvents>>;
	past: Awaited<ReturnType<typeof getPastEvents>>;
};

const partifulCache: {
	value: PartifulLists | null;
	fetchedAt: number;
	inflight: Promise<PartifulLists> | null;
} = { value: null, fetchedAt: 0, inflight: null };

async function getPartifulLists(force: boolean): Promise<PartifulLists> {
	const fresh =
		partifulCache.value &&
		Date.now() - partifulCache.fetchedAt < PARTIFUL_CACHE_TTL_MS;
	if (!force && fresh) return partifulCache.value as PartifulLists;
	if (partifulCache.inflight) return partifulCache.inflight;

	partifulCache.inflight = Promise.all([getUpcomingEvents(), getPastEvents()])
		.then(([upcoming, past]) => {
			partifulCache.value = { upcoming, past };
			partifulCache.fetchedAt = Date.now();
			return partifulCache.value;
		})
		.catch((err) => {
			if (partifulCache.value) return partifulCache.value; // serve stale
			throw err;
		})
		.finally(() => {
			partifulCache.inflight = null;
		});
	return partifulCache.inflight;
}

export async function GET(request: Request) {
	const force = new URL(request.url).searchParams.get("refresh") === "1";
	const { upcoming, past } = await getPartifulLists(force);

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
	const runMetaRows = queries.getRunDisplayTitles.all() as {
		eventId: string;
		displayTitle: string | null;
		syncedAt: string | null;
		goingCount: number;
		isHosting: number | null;
	}[];
	const runMetaMap = new Map(runMetaRows.map((r) => [r.eventId, r]));

	const paymentSummaryRows = queries.getPaymentSummaries.all() as {
		eventId: string;
		paidCount: number;
		totalCount: number;
	}[];
	const paymentMap = new Map(paymentSummaryRows.map((s) => [s.eventId, s]));

	// Cancelled Partiful events are marked not-hosting so they stop generating charges.
	// One-way only — never flips a run back to hosting, since a run can be not-hosting
	// for reasons unrelated to cancellation.
	const markCancelledRuns = (events: PartifulEventRaw[]) => {
		for (const event of events) {
			if (!isCancelledEvent(event)) continue;
			const meta = runMetaMap.get(event.id);
			if (!meta || meta.isHosting === 0) continue;
			queries.updateRunHosting.run({ eventId: event.id, isHosting: 0 });
			meta.isHosting = 0;
		}
	};

	const upcomingVball = (
		(upcoming.result.data.upcomingEvents ?? []) as PartifulEventRaw[]
	).filter(isVballEvent);
	const pastVball = (
		(past.result.data.pastEvents ?? []) as PartifulEventRaw[]
	).filter(isVballEvent);

	markCancelledRuns(upcomingVball);
	markCancelledRuns(pastVball);

	const enrich = (event: PartifulEventRaw): EnrichedEvent => ({
		...event,
		displayTitle: runMetaMap.get(event.id)?.displayTitle ?? null,
		syncedAt: runMetaMap.get(event.id)?.syncedAt ?? null,
		goingCount: runMetaMap.get(event.id)?.goingCount ?? 0,
		paidCount: paymentMap.get(event.id)?.paidCount ?? 0,
		totalCount: paymentMap.get(event.id)?.totalCount ?? 0,
		isHosting: runMetaMap.get(event.id)?.isHosting !== 0,
	});

	return NextResponse.json({
		upcoming: [...upcomingVball.map(enrich), ...upcomingManual.map(enrich)],
		past: [...pastVball.map(enrich), ...pastManual.map(enrich)],
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
		syncedAt: null,
		goingCount: 0,
		startDate: startDate ?? null,
		status: "manual",
		paidCount: 0,
		totalCount: 0,
		isHosting: true,
	});
}
