"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildOwedReminder } from "@/lib/utils";

interface PlayerBasic {
	userId: string;
	name: string;
	displayName: string | null;
}

interface PlusOneEntry {
	userId: string;
	amountOwed: number;
	amountPaid: number | null;
	paid: boolean;
}

interface RunEntry {
	eventId: string;
	title: string;
	startDate: string | null;
	amountOwed: number;
	amountPaid: number | null;
	paid: boolean;
	plusOnes: PlusOneEntry[];
}

interface PlayerProfile {
	userId: string;
	name: string;
	displayName: string | null;
	notes: string | null;
	balance: number;
	currentStreak: number;
	bestStreak: number;
	runs: RunEntry[];
}

export default function PlayerProfilePage({
	params,
}: {
	params: { id: string };
}) {
	const router = useRouter();
	const [player, setPlayer] = useState<PlayerProfile | null>(null);
	const [loading, setLoading] = useState(true);
	const [editingName, setEditingName] = useState(false);
	const [nameVal, setNameVal] = useState("");
	const [editingNotes, setEditingNotes] = useState(false);
	const [notesVal, setNotesVal] = useState("");
	const [copied, setCopied] = useState(false);
	const [showMerge, setShowMerge] = useState(false);
	const [mergeQuery, setMergeQuery] = useState("");
	const [mergePlayers, setMergePlayers] = useState<PlayerBasic[]>([]);
	const [mergeTarget, setMergeTarget] = useState<PlayerBasic | null>(null);
	const [merging, setMerging] = useState(false);
	const [prevPlayerId, setPrevPlayerId] = useState<string | null>(null);
	const [nextPlayerId, setNextPlayerId] = useState<string | null>(null);

	const load = useCallback(async () => {
		const [res, allRes] = await Promise.all([
			fetch(`/api/players/${params.id}`),
			fetch("/api/players"),
		]);
		if (res.ok) {
			const data = await res.json();
			setPlayer(data);
			setNameVal(data.displayName ?? "");
			setNotesVal(data.notes ?? "");
		}
		if (allRes.ok) {
			const all = (await allRes.json()) as PlayerBasic[];
			const idx = all.findIndex((p) => p.userId === params.id);
			setPrevPlayerId(idx > 0 ? all[idx - 1].userId : null);
			setNextPlayerId(
				idx >= 0 && idx < all.length - 1 ? all[idx + 1].userId : null,
			);
		}
		setLoading(false);
	}, [params.id]);

	useEffect(() => {
		load();
	}, [load]);

	const saveName = async () => {
		await fetch(`/api/players/${params.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ displayName: nameVal.trim() || null }),
		});
		setPlayer((prev) =>
			prev ? { ...prev, displayName: nameVal.trim() || null } : prev,
		);
		setEditingName(false);
	};

	const saveNotes = async () => {
		await fetch(`/api/players/${params.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ notes: notesVal.trim() || null }),
		});
		setPlayer((prev) =>
			prev ? { ...prev, notes: notesVal.trim() || null } : prev,
		);
		setEditingNotes(false);
	};

	const recordPayment = async (
		eventId: string,
		userId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => {
		await fetch(`/api/runs/${eventId}/payments`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId, amount: amountOwed, amountPaid }),
		});
		setPlayer((prev) => {
			if (!prev) return prev;
			const updatedRuns = prev.runs.map((r) => {
				if (r.eventId !== eventId) return r;
				if (userId === params.id) {
					return { ...r, amountPaid, paid: amountPaid != null };
				}
				// +1 payment
				return {
					...r,
					plusOnes: r.plusOnes.map((p1) =>
						p1.userId === userId
							? { ...p1, amountPaid, paid: amountPaid != null }
							: p1,
					),
				};
			});
			const newBalance = updatedRuns.reduce((sum, r) => {
				const own = (r.amountPaid ?? 0) - r.amountOwed;
				const p1s = r.plusOnes.reduce(
					(s, p1) => s + (p1.amountPaid ?? 0) - p1.amountOwed,
					0,
				);
				return sum + own + p1s;
			}, 0);
			return { ...prev, balance: newBalance, runs: updatedRuns };
		});
	};

	const openMerge = async () => {
		setShowMerge(true);
		if (mergePlayers.length === 0) {
			const res = await fetch("/api/players");
			if (res.ok) {
				const all = (await res.json()) as PlayerBasic[];
				setMergePlayers(
					all.filter(
						(p) => !p.userId.startsWith("manual-") && p.userId !== params.id,
					),
				);
			}
		}
	};

	const doMerge = async () => {
		if (!mergeTarget) return;
		setMerging(true);
		const res = await fetch(`/api/players/${params.id}/merge`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ targetUserId: mergeTarget.userId }),
		});
		if (res.ok) {
			router.push(`/players/${mergeTarget.userId}`);
		} else {
			setMerging(false);
		}
	};

	const copyReminder = async () => {
		if (!player) return;
		const unpaidRuns = player.runs.filter(
			(r) =>
				!r.paid &&
				r.startDate != null &&
				r.startDate <= new Date().toISOString(),
		);
		const lines = unpaidRuns.map((r) => {
			const date = r.startDate
				? new Date(r.startDate).toLocaleDateString("en-CA", {
						month: "short",
						day: "numeric",
						timeZone: "America/Toronto",
					})
				: "Unknown date";
			return `• ${date} ($${r.amountOwed.toFixed(2)})`;
		});
		const msg = buildOwedReminder(player.balance, lines);
		await navigator.clipboard.writeText(msg);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	if (loading) return <p className="text-muted-foreground">Loading...</p>;
	if (!player) return <p className="text-destructive">Player not found</p>;

	const displayName = player.displayName ?? player.name;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between text-sm">
				{prevPlayerId ? (
					<Link
						href={`/players/${prevPlayerId}`}
						className="text-muted-foreground hover:text-foreground"
					>
						← Prev player
					</Link>
				) : (
					<span />
				)}
				<Link
					href="/players"
					className="text-xs text-muted-foreground hover:text-foreground"
				>
					All players
				</Link>
				{nextPlayerId ? (
					<Link
						href={`/players/${nextPlayerId}`}
						className="text-muted-foreground hover:text-foreground"
					>
						Next player →
					</Link>
				) : (
					<span />
				)}
			</div>

			<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
				<div className="space-y-1">
					{editingName ? (
						<div className="flex items-center gap-2">
							<input
								value={nameVal}
								onChange={(e) => setNameVal(e.target.value)}
								className="text-2xl font-bold border-b border-input bg-transparent outline-none w-full sm:w-auto"
								autoFocus
								onKeyDown={(e) => {
									if (e.key === "Enter") saveName();
									if (e.key === "Escape") setEditingName(false);
								}}
							/>
							<Button size="sm" onClick={saveName}>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setEditingName(false)}
							>
								✕
							</Button>
						</div>
					) : (
						<h1
							className="text-2xl font-bold cursor-pointer hover:underline decoration-dotted"
							onClick={() => setEditingName(true)}
							title="Click to set display name"
						>
							{displayName} ✎
						</h1>
					)}
					{player.displayName && (
						<p className="text-sm text-muted-foreground flex items-center gap-2">
							<span>Partiful: {player.name}</span>
							<button
								onClick={async () => {
									await fetch(`/api/players/${params.id}`, {
										method: "PATCH",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({ displayName: null }),
									});
									setPlayer((prev) =>
										prev ? { ...prev, displayName: null } : prev,
									);
									setNameVal("");
								}}
								className="text-xs text-muted-foreground/60 hover:text-destructive transition-colors"
								title="Remove alias"
							>
								✕
							</button>
						</p>
					)}
				</div>

				<div className="sm:text-right space-y-1">
					<div
						className={`text-2xl font-bold ${
							player.balance < 0
								? "text-destructive"
								: player.balance > 0
									? "text-green-600"
									: "text-muted-foreground"
						}`}
					>
						{player.balance < 0
							? `-$${Math.abs(player.balance).toFixed(2)}`
							: player.balance > 0
								? `+$${player.balance.toFixed(2)}`
								: "$0.00"}
					</div>
					<p className="text-xs text-muted-foreground">
						{player.balance < 0
							? "owes"
							: player.balance > 0
								? "credit"
								: "settled"}
					</p>
					{player.balance < 0 && (
						<Button size="sm" variant="outline" onClick={copyReminder}>
							{copied ? "Copied!" : "Copy reminder"}
						</Button>
					)}
				</div>
			</div>

			{(() => {
				const now = new Date().toISOString();
				const pastRuns = player.runs.filter(
					(r) => r.startDate == null || r.startDate <= now,
				);
				const totalPaid = pastRuns.reduce(
					(sum, r) => sum + (r.amountPaid ?? 0),
					0,
				);
				const stats: { label: string; value: string }[] = [
					{ label: "runs", value: String(pastRuns.length) },
					{ label: "paid out", value: `$${totalPaid.toFixed(0)}` },
					...(player.currentStreak > 1
						? [{ label: "streak", value: `🔥 ${player.currentStreak}` }]
						: []),
					...(player.bestStreak > 1
						? [{ label: "best streak", value: String(player.bestStreak) }]
						: []),
				];
				return (
					<div className="flex flex-wrap gap-x-6 gap-y-2">
						{stats.map((s) => (
							<div key={s.label} className="flex flex-col items-center">
								<span className="text-base font-semibold">{s.value}</span>
								<span className="text-xs text-muted-foreground">{s.label}</span>
							</div>
						))}
					</div>
				);
			})()}

			<div className="space-y-1">
				<p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
					Notes
				</p>
				{editingNotes ? (
					<div className="space-y-2">
						<textarea
							value={notesVal}
							onChange={(e) => setNotesVal(e.target.value)}
							className="w-full border rounded px-2 py-1 text-sm min-h-[60px]"
							autoFocus
						/>
						<div className="flex gap-2">
							<Button size="sm" onClick={saveNotes}>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setEditingNotes(false)}
							>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<p
						className="text-sm text-muted-foreground cursor-pointer hover:text-foreground"
						onClick={() => setEditingNotes(true)}
					>
						{player.notes || <em>Add notes...</em>}
					</p>
				)}
			</div>

			{params.id.startsWith("manual-") && (
				<div className="space-y-2 rounded-lg border p-4">
					<p className="text-sm font-medium">Merge with Partiful account</p>
					<p className="text-xs text-muted-foreground">
						Moves all attendance and payment history to the selected player,
						then deletes this manual entry.
					</p>
					{!showMerge ? (
						<Button variant="outline" size="sm" onClick={openMerge}>
							Merge…
						</Button>
					) : mergeTarget ? (
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-sm">
								Merge into{" "}
								<strong>{mergeTarget.displayName ?? mergeTarget.name}</strong>?
							</span>
							<Button size="sm" onClick={doMerge} disabled={merging}>
								{merging ? "Merging…" : "Confirm"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setMergeTarget(null)}
							>
								Change
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => {
									setShowMerge(false);
									setMergeTarget(null);
									setMergeQuery("");
								}}
							>
								Cancel
							</Button>
						</div>
					) : (
						<div className="space-y-1">
							<input
								value={mergeQuery}
								onChange={(e) => setMergeQuery(e.target.value)}
								placeholder="Search Partiful players…"
								className="border rounded px-2 py-1 text-sm w-full"
								autoFocus
							/>
							{mergeQuery.trim() && (
								<div className="border rounded overflow-hidden text-sm">
									{mergePlayers
										.filter((p) => {
											const q = mergeQuery.trim().toLowerCase();
											return (
												(p.displayName ?? p.name).toLowerCase().includes(q) ||
												p.name.toLowerCase().includes(q)
											);
										})
										.map((p) => (
											<button
												key={p.userId}
												className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2"
												onClick={() => setMergeTarget(p)}
											>
												<span className="font-medium">
													{p.displayName ?? p.name}
												</span>
												{p.displayName && (
													<span className="text-muted-foreground text-xs">
														{p.name}
													</span>
												)}
											</button>
										))}
								</div>
							)}
						</div>
					)}
				</div>
			)}

			<div className="space-y-2">
				<h2 className="font-semibold">Run History</h2>
				{player.runs.length === 0 && (
					<p className="text-sm text-muted-foreground">No runs yet.</p>
				)}
				{player.runs.length > 0 && (
					<>
						{/* Mobile: card per run */}
						<div className="sm:hidden space-y-2">
							{player.runs.map((run) => (
								<MobileRunCard
									key={run.eventId}
									run={run}
									playerId={params.id}
									onRecord={recordPayment}
								/>
							))}
						</div>

						{/* Desktop: table */}
						<div className="hidden sm:block rounded-lg border overflow-hidden">
							<table className="w-full text-sm">
								<thead className="bg-muted text-muted-foreground">
									<tr>
										<th className="text-left px-4 py-2 font-medium">Run</th>
										<th className="text-center px-4 py-2 font-medium">Owed</th>
										<th className="text-center px-4 py-2 font-medium">Paid</th>
										<th className="text-center px-4 py-2 font-medium">
											Status
										</th>
										<th className="px-4 py-2"></th>
									</tr>
								</thead>
								<tbody>
									{player.runs.map((run, i) => (
										<RunHistoryRow
											key={run.eventId}
											run={run}
											playerId={params.id}
											striped={i % 2 !== 0}
											onRecord={recordPayment}
										/>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

function RunHistoryRow({
	run,
	playerId,
	striped,
	onRecord,
}: {
	run: RunEntry;
	playerId: string;
	striped: boolean;
	onRecord: (
		eventId: string,
		userId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => void;
}) {
	const isFuture =
		run.startDate != null && run.startDate > new Date().toISOString();

	const date = run.startDate
		? new Date(run.startDate).toLocaleDateString("en-CA", {
				month: "short",
				day: "numeric",
				year: "numeric",
				timeZone: "America/Toronto",
			})
		: "—";

	const status = !run.paid ? "unpaid" : "paid";

	return (
		<>
			<tr
				className={`${striped ? "bg-muted/30" : "bg-background"} ${isFuture ? "opacity-50" : ""}`}
			>
				<td className="px-4 py-2">
					<Link
						href={`/runs/${run.eventId}`}
						className="font-medium hover:underline"
					>
						{run.title}
					</Link>
					<p className="text-xs text-muted-foreground">{date}</p>
				</td>
				<td className="px-4 py-2 text-center">${run.amountOwed.toFixed(2)}</td>
				<td className="px-4 py-2 text-center">
					{run.amountPaid != null ? `$${run.amountPaid.toFixed(2)}` : "—"}
				</td>
				<td className="px-4 py-2 text-center">
					<Badge variant={status === "paid" ? "default" : "outline"}>
						{status}
					</Badge>
				</td>
				<td className="px-4 py-2 text-right">
					<Button
						size="sm"
						variant={run.paid ? "default" : "outline"}
						onClick={() =>
							onRecord(
								run.eventId,
								playerId,
								run.amountOwed,
								run.paid ? null : run.amountOwed,
							)
						}
					>
						{run.paid ? "✓ Paid" : "Mark Paid"}
					</Button>
				</td>
			</tr>
			{run.plusOnes.map((p1) => (
				<tr
					key={p1.userId}
					className={`${striped ? "bg-muted/30" : "bg-background"} ${isFuture ? "opacity-50" : ""} opacity-80`}
				>
					<td className="pl-8 pr-4 py-1.5">
						<span className="text-xs text-muted-foreground">+1</span>
					</td>
					<td className="px-4 py-1.5 text-center text-xs">
						${p1.amountOwed.toFixed(2)}
					</td>
					<td className="px-4 py-1.5 text-center text-xs">
						{p1.amountPaid != null ? `$${p1.amountPaid.toFixed(2)}` : "—"}
					</td>
					<td className="px-4 py-1.5 text-center">
						<Badge
							variant={p1.paid ? "default" : "outline"}
							className="text-xs"
						>
							{p1.paid ? "paid" : "unpaid"}
						</Badge>
					</td>
					<td className="px-4 py-1.5 text-right">
						<Button
							size="sm"
							variant={p1.paid ? "default" : "outline"}
							onClick={() =>
								onRecord(
									run.eventId,
									p1.userId,
									p1.amountOwed,
									p1.paid ? null : p1.amountOwed,
								)
							}
						>
							{p1.paid ? "✓ Paid" : "Mark Paid"}
						</Button>
					</td>
				</tr>
			))}
		</>
	);
}

function MobileRunCard({
	run,
	playerId,
	onRecord,
}: {
	run: RunEntry;
	playerId: string;
	onRecord: (
		eventId: string,
		userId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => void;
}) {
	const isFuture =
		run.startDate != null && run.startDate > new Date().toISOString();

	const date = run.startDate
		? new Date(run.startDate).toLocaleDateString("en-CA", {
				month: "short",
				day: "numeric",
				year: "numeric",
				timeZone: "America/Toronto",
			})
		: "—";

	const status = !run.paid ? "unpaid" : "paid";

	return (
		<div
			className={`rounded-lg border px-4 py-3 space-y-2 ${isFuture ? "opacity-50" : ""}`}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<Link
						href={`/runs/${run.eventId}`}
						className="font-medium hover:underline truncate block"
					>
						{run.title}
					</Link>
					<p className="text-xs text-muted-foreground">{date}</p>
				</div>
				<Badge variant={status === "paid" ? "default" : "outline"}>
					{status}
				</Badge>
			</div>
			<div className="flex items-center gap-3 text-sm text-muted-foreground">
				<span>Owed: ${run.amountOwed.toFixed(2)}</span>
				{run.amountPaid != null && (
					<span>Paid: ${run.amountPaid.toFixed(2)}</span>
				)}
			</div>
			<Button
				size="sm"
				variant={run.paid ? "default" : "outline"}
				onClick={() =>
					onRecord(
						run.eventId,
						playerId,
						run.amountOwed,
						run.paid ? null : run.amountOwed,
					)
				}
			>
				{run.paid ? "✓ Paid" : "Mark Paid"}
			</Button>
			{run.plusOnes.length > 0 && (
				<div className="border-t pt-2 mt-1 space-y-2">
					{run.plusOnes.map((p1) => (
						<div
							key={p1.userId}
							className="pl-3 border-l-2 border-muted space-y-1"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-xs text-muted-foreground">+1</span>
								<Badge
									variant={p1.paid ? "default" : "outline"}
									className="text-xs"
								>
									{p1.paid ? "paid" : "unpaid"}
								</Badge>
							</div>
							<div className="flex items-center gap-3 text-xs text-muted-foreground">
								<span>Owed: ${p1.amountOwed.toFixed(2)}</span>
								{p1.amountPaid != null && (
									<span>Paid: ${p1.amountPaid.toFixed(2)}</span>
								)}
							</div>
							<Button
								size="sm"
								variant={p1.paid ? "default" : "outline"}
								onClick={() =>
									onRecord(
										run.eventId,
										p1.userId,
										p1.amountOwed,
										p1.paid ? null : p1.amountOwed,
									)
								}
							>
								{p1.paid ? "✓ Paid" : "Mark Paid"}
							</Button>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
