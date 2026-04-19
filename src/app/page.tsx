"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PartifulEvent {
	id: string;
	title: string;
	displayTitle: string | null;
	startDate: string | null;
	status: string;
	paidCount: number;
	totalCount: number;
}

interface PlayerBalance {
	userId: string;
	name: string;
	displayName: string | null;
	balance: number;
}

const PAST_PAGE_SIZE = 5;

export default function Dashboard() {
	const router = useRouter();
	const [upcoming, setUpcoming] = useState<PartifulEvent[]>([]);
	const [past, setPast] = useState<PartifulEvent[]>([]);
	const [players, setPlayers] = useState<PlayerBalance[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const [newDate, setNewDate] = useState("");
	const [creating, setCreating] = useState(false);
	const [outstandingOpen, setOutstandingOpen] = useState(false);
	const [showDotMenu, setShowDotMenu] = useState(false);
	const [pastPagesShown, setPastPagesShown] = useState(1);
	const dotMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!showDotMenu) return;
		function handleClickOutside(e: MouseEvent) {
			if (
				dotMenuRef.current &&
				!dotMenuRef.current.contains(e.target as Node)
			) {
				setShowDotMenu(false);
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [showDotMenu]);

	useEffect(() => {
		Promise.all([fetch("/api/runs"), fetch("/api/players")])
			.then(async ([runsRes, playersRes]) => {
				if (!runsRes.ok)
					throw new Error(`Failed to load runs: ${runsRes.status}`);
				const d = await runsRes.json();
				setUpcoming(d.upcoming);
				setPast(d.past);
				if (playersRes.ok) setPlayers(await playersRes.json());
			})
			.catch((e) => setError(e.message))
			.finally(() => setLoading(false));
	}, []);

	async function createRun() {
		if (!newTitle.trim()) return;
		setCreating(true);
		try {
			const res = await fetch("/api/runs", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: newTitle.trim(),
					startDate: newDate || null,
				}),
			});
			if (!res.ok) throw new Error("Failed to create run");
			const run = (await res.json()) as PartifulEvent;
			router.push(`/runs/${run.id}`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unknown error");
			setCreating(false);
		}
	}

	if (loading) return <p className="text-muted-foreground">Loading runs...</p>;
	if (error) return <p className="text-destructive">Error: {error}</p>;

	const owing = players.filter((p) => p.balance < 0);
	const totalOutstanding = owing.reduce(
		(sum, p) => sum + Math.abs(p.balance),
		0,
	);

	// Sort upcoming ASC (nearest first for display; last item = most future for "new run" nav)
	const sortedUpcoming = [...upcoming].sort((a, b) => {
		if (!a.startDate && !b.startDate) return 0;
		if (!a.startDate) return 1;
		if (!b.startDate) return -1;
		return a.startDate.localeCompare(b.startDate);
	});
	const nextRun = sortedUpcoming[0] ?? null;
	const otherUpcoming = sortedUpcoming.slice(1);

	// Sort past DESC (most recent first)
	const sortedPast = [...past].sort((a, b) => {
		if (!a.startDate && !b.startDate) return 0;
		if (!a.startDate) return 1;
		if (!b.startDate) return -1;
		return b.startDate.localeCompare(a.startDate);
	});
	const visiblePast = sortedPast.slice(0, pastPagesShown * PAST_PAGE_SIZE);

	// "Latest run" for the New Run button: most future upcoming, or most recent past
	const mostFutureUpcoming = sortedUpcoming[sortedUpcoming.length - 1] ?? null;
	const latestRun = mostFutureUpcoming ?? sortedPast[0] ?? null;

	return (
		<div className="space-y-8">
			{/* Outstanding section */}
			{owing.length > 0 && (
				<div className="space-y-2">
					<button
						onClick={() => setOutstandingOpen((v) => !v)}
						className="flex flex-wrap items-center gap-x-4 gap-y-1 hover:opacity-75 transition-opacity"
					>
						<h2 className="text-lg font-semibold">Outstanding</h2>
						<span className="text-destructive font-bold">
							${totalOutstanding.toFixed(2)}
						</span>
						<span className="text-sm text-muted-foreground">
							({owing.length} player{owing.length !== 1 ? "s" : ""})
						</span>
						<span className="text-muted-foreground text-sm">
							{outstandingOpen ? "▲" : "▼"}
						</span>
					</button>
					{outstandingOpen && (
						<div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-1">
							{owing.map((p) => (
								<div
									key={p.userId}
									className="flex items-center justify-between text-sm"
								>
									<Link
										href={`/players/${p.userId}`}
										className="hover:underline"
									>
										{p.displayName ?? p.name}
									</Link>
									<span className="text-destructive font-medium">
										${Math.abs(p.balance).toFixed(2)}
									</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{/* Upcoming Runs */}
			<div>
				<div className="flex items-center justify-between mb-4">
					<h1 className="text-2xl font-bold">Upcoming Runs</h1>
					<div className="relative flex items-center gap-1" ref={dotMenuRef}>
						<Button
							variant="outline"
							size="sm"
							onClick={() => latestRun && router.push(`/runs/${latestRun.id}`)}
							disabled={!latestRun}
						>
							+ New Run
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="px-2"
							onClick={() => setShowDotMenu((v) => !v)}
							aria-label="More options"
						>
							···
						</Button>
						{showDotMenu && (
							<div className="absolute top-full right-0 mt-1 bg-background border rounded shadow-md z-10 min-w-[160px]">
								<button
									className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
									onClick={() => {
										setShowDotMenu(false);
										setShowCreateForm(true);
									}}
								>
									Create manual run
								</button>
							</div>
						)}
					</div>
				</div>

				{showCreateForm && (
					<div className="flex flex-col gap-2 mb-4 p-4 border rounded-lg">
						<input
							placeholder="Title"
							value={newTitle}
							onChange={(e) => setNewTitle(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && createRun()}
							autoFocus
							className="border rounded px-2 py-1 text-sm w-full"
						/>
						<input
							type="datetime-local"
							value={newDate}
							onChange={(e) => setNewDate(e.target.value)}
							className="border rounded px-2 py-1 text-sm w-full"
						/>
						<div className="flex gap-2">
							<Button
								onClick={createRun}
								disabled={!newTitle.trim() || creating}
							>
								{creating ? "Creating…" : "Create Run"}
							</Button>
							<Button
								variant="ghost"
								onClick={() => {
									setShowCreateForm(false);
									setNewTitle("");
									setNewDate("");
								}}
							>
								Cancel
							</Button>
						</div>
					</div>
				)}

				{sortedUpcoming.length === 0 && !showCreateForm && (
					<p className="text-muted-foreground">No upcoming runs.</p>
				)}

				{nextRun && (
					<div className="mb-3">
						<PrimaryUpcomingCard event={nextRun} />
					</div>
				)}

				{otherUpcoming.length > 0 && (
					<div className="space-y-1.5">
						{otherUpcoming.map((event) => (
							<CompactUpcomingTile key={event.id} event={event} />
						))}
					</div>
				)}
			</div>

			{/* Past Runs */}
			<div>
				<h2 className="text-2xl font-bold mb-4">Past Runs</h2>
				{sortedPast.length === 0 && (
					<p className="text-muted-foreground">No past runs.</p>
				)}
				<div className="space-y-1.5">
					{visiblePast.map((event) => (
						<PastRunTile key={event.id} event={event} />
					))}
				</div>
				{sortedPast.length > visiblePast.length && (
					<Button
						variant="ghost"
						size="sm"
						className="mt-3"
						onClick={() => setPastPagesShown((n) => n + 1)}
					>
						Load more ({sortedPast.length - visiblePast.length} remaining)
					</Button>
				)}
			</div>
		</div>
	);
}

function PrimaryUpcomingCard({ event }: { event: PartifulEvent }) {
	const date = event.startDate
		? new Date(event.startDate).toLocaleDateString("en-CA", {
				weekday: "short",
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
				timeZone: "America/Toronto",
			})
		: "TBD";
	const displayTitle = event.displayTitle ?? event.title;

	return (
		<Link href={`/runs/${event.id}`} className="block">
			<Card className="hover:bg-muted/30 transition-colors cursor-pointer">
				<CardHeader className="py-3">
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0">
							<CardTitle className="text-base truncate">
								{displayTitle}
							</CardTitle>
							<p className="text-sm text-muted-foreground mt-0.5">{date}</p>
						</div>
						{event.totalCount > 0 && (
							<span className="text-sm text-muted-foreground shrink-0">
								{event.paidCount}/{event.totalCount} paid
							</span>
						)}
					</div>
				</CardHeader>
			</Card>
		</Link>
	);
}

function CompactUpcomingTile({ event }: { event: PartifulEvent }) {
	const date = event.startDate
		? new Date(event.startDate).toLocaleDateString("en-CA", {
				weekday: "short",
				month: "short",
				day: "numeric",
				timeZone: "America/Toronto",
			})
		: "TBD";
	const displayTitle = event.displayTitle ?? event.title;

	return (
		<Link
			href={`/runs/${event.id}`}
			className="flex items-center justify-between px-4 py-2 rounded-lg border hover:bg-muted/30 transition-colors"
		>
			<span className="text-sm font-medium">{date}</span>
			<span className="text-xs text-muted-foreground truncate ml-3 max-w-[60%] text-right">
				{displayTitle}
			</span>
		</Link>
	);
}

function PastRunTile({ event }: { event: PartifulEvent }) {
	const date = event.startDate
		? new Date(event.startDate).toLocaleDateString("en-CA", {
				weekday: "short",
				month: "short",
				day: "numeric",
				timeZone: "America/Toronto",
			})
		: "TBD";
	const displayTitle = event.displayTitle ?? event.title;

	return (
		<Link
			href={`/runs/${event.id}`}
			className="flex items-center justify-between px-4 py-2.5 rounded-lg border hover:bg-muted/30 transition-colors"
		>
			<div className="min-w-0">
				<p className="text-sm font-medium truncate">{displayTitle}</p>
				<p className="text-xs text-muted-foreground">{date}</p>
			</div>
			{event.totalCount > 0 && (
				<span className="text-xs text-muted-foreground shrink-0 ml-3">
					{event.paidCount}/{event.totalCount} paid
				</span>
			)}
		</Link>
	);
}
