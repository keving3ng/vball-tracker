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
}

function buildReminder(balance: number, owingRuns: number): string {
	const owed = Math.abs(balance).toFixed(2);
	return `Hey, you owe $${owed} from ${owingRuns} run${owingRuns !== 1 ? "s" : ""}. Please etransfer me at kevingeng33@gmail.com when you get the chance!`;
}

export default function PlayersPage() {
	const [players, setPlayers] = useState<PlayerStats[]>([]);
	const [loading, setLoading] = useState(true);
	const [copiedId, setCopiedId] = useState<string | null>(null);

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

	if (loading)
		return <p className="text-muted-foreground">Loading players...</p>;

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold">Players</h1>

			{/* Mobile: card stack */}
			<div className="sm:hidden space-y-2">
				{players.map((p) => (
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
							<th className="text-left px-4 py-2 font-medium">Player</th>
							<th className="text-center px-4 py-2 font-medium">Runs</th>
							<th className="text-center px-4 py-2 font-medium">Balance</th>
							<th className="px-4 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{players.map((p, i) => (
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
