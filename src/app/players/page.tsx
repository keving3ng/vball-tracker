"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PlayerStats {
	userId: string;
	name: string;
	displayName: string | null;
	totalRuns: number;
	owingRuns: number;
	balance: number;
	lastAttendedDate: string | null;
}

type SortKey = "name" | "runs" | "balance" | "lastAttended";
type SortDir = "asc" | "desc";

function buildReminder(balance: number, owingRuns: number): string {
	const owed = Math.abs(balance).toFixed(2);
	return `Hey, you owe $${owed} from ${owingRuns} run${owingRuns !== 1 ? "s" : ""}. Please etransfer me at kevingeng33@gmail.com when you get the chance!`;
}

function fmtDate(iso: string | null): string {
	if (!iso) return "—";
	return new Date(iso).toLocaleDateString("en-CA", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "America/Toronto",
	});
}

export default function PlayersPage() {
	const [players, setPlayers] = useState<PlayerStats[]>([]);
	const [loading, setLoading] = useState(true);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [sortKey, setSortKey] = useState<SortKey>("runs");
	const [sortDir, setSortDir] = useState<SortDir>("desc");

	useEffect(() => {
		fetch("/api/players")
			.then((r) => {
				if (!r.ok) throw new Error(`Failed to load players: ${r.status}`);
				return r.json();
			})
			.then(setPlayers)
			.finally(() => setLoading(false));
	}, []);

	async function copyReminder(p: PlayerStats) {
		await navigator.clipboard.writeText(buildReminder(p.balance, p.owingRuns));
		setCopiedId(p.userId);
		setTimeout(() => setCopiedId((id) => (id === p.userId ? null : id)), 2000);
	}

	function toggleSort(key: SortKey) {
		if (sortKey === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDir(key === "name" ? "asc" : "desc");
		}
	}

	const sorted = [...players].sort((a, b) => {
		let cmp = 0;
		if (sortKey === "name") {
			const na = (a.displayName ?? a.name).toLowerCase();
			const nb = (b.displayName ?? b.name).toLowerCase();
			cmp = na.localeCompare(nb);
		} else if (sortKey === "runs") {
			cmp = a.totalRuns - b.totalRuns;
		} else if (sortKey === "balance") {
			cmp = a.balance - b.balance;
		} else if (sortKey === "lastAttended") {
			if (!a.lastAttendedDate && !b.lastAttendedDate) cmp = 0;
			else if (!a.lastAttendedDate) cmp = -1;
			else if (!b.lastAttendedDate) cmp = 1;
			else cmp = a.lastAttendedDate.localeCompare(b.lastAttendedDate);
		}
		return sortDir === "asc" ? cmp : -cmp;
	});

	function SortHeader({
		label,
		col,
		className,
	}: {
		label: string;
		col: SortKey;
		className?: string;
	}) {
		const active = sortKey === col;
		return (
			<th
				className={`px-4 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors ${className ?? ""}`}
				onClick={() => toggleSort(col)}
			>
				{label}
				<span className="ml-1 text-xs">
					{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
				</span>
			</th>
		);
	}

	if (loading)
		return <p className="text-muted-foreground">Loading players...</p>;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Players</h1>

			{/* Mobile: card stack */}
			<div className="sm:hidden space-y-2">
				{sorted.map((p) => (
					<div
						key={p.userId}
						className="flex items-center justify-between px-4 py-3 rounded-lg border"
					>
						<Link
							href={`/players/${p.userId}`}
							className="flex-1 min-w-0 hover:opacity-75"
						>
							<span className="font-medium">{p.displayName ?? p.name}</span>
							{p.displayName && (
								<span className="ml-1 text-xs text-muted-foreground">
									({p.name})
								</span>
							)}
							<p className="text-xs text-muted-foreground">
								{p.totalRuns} runs
								{p.lastAttendedDate && (
									<span className="ml-2">· {fmtDate(p.lastAttendedDate)}</span>
								)}
							</p>
						</Link>
						<div className="flex items-center gap-2 shrink-0 ml-2">
							{p.balance < 0 ? (
								<>
									<button
										onClick={() => copyReminder(p)}
										className="text-xs text-muted-foreground hover:text-foreground transition-colors"
									>
										{copiedId === p.userId ? "Copied!" : "Copy"}
									</button>
									<span className="text-destructive font-medium text-sm">
										${Math.abs(p.balance).toFixed(2)} owed
									</span>
								</>
							) : p.balance > 0 ? (
								<span className="text-green-600 font-medium text-sm">
									${p.balance.toFixed(2)} credit
								</span>
							) : (
								<span className="text-muted-foreground text-sm">—</span>
							)}
						</div>
					</div>
				))}
			</div>

			{/* Desktop: table */}
			<div className="hidden sm:block rounded-lg border overflow-hidden">
				<table className="w-full text-sm">
					<thead className="bg-muted text-muted-foreground">
						<tr>
							<SortHeader label="Player" col="name" className="text-left" />
							<SortHeader label="Runs" col="runs" className="text-center" />
							<SortHeader
								label="Last Attended"
								col="lastAttended"
								className="text-center"
							/>
							<SortHeader label="Balance" col="balance" className="text-center" />
							<th className="px-4 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{sorted.map((p, i) => (
							<tr
								key={p.userId}
								className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}
							>
								<td className="px-4 py-2">
									<Link
										href={`/players/${p.userId}`}
										className="block font-medium hover:underline"
									>
										{p.displayName ?? p.name}
										{p.displayName && (
											<span className="ml-1 text-xs text-muted-foreground">
												({p.name})
											</span>
										)}
									</Link>
								</td>
								<td className="px-4 py-2 text-center">{p.totalRuns}</td>
								<td className="px-4 py-2 text-center text-muted-foreground">
									{fmtDate(p.lastAttendedDate)}
								</td>
								<td className="px-4 py-2 text-center">
									{p.balance < 0 ? (
										<span className="text-destructive font-medium">
											${Math.abs(p.balance).toFixed(2)} owed
										</span>
									) : p.balance > 0 ? (
										<span className="text-green-600 font-medium">
											${p.balance.toFixed(2)} credit
										</span>
									) : (
										"—"
									)}
								</td>
								<td className="px-4 py-2 text-right">
									{p.balance < 0 && (
										<button
											onClick={() => copyReminder(p)}
											className="text-xs text-muted-foreground hover:text-foreground transition-colors"
										>
											{copiedId === p.userId ? "Copied!" : "Copy reminder"}
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
