"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PlayerBasic {
	userId: string;
	name: string;
	displayName: string | null;
}

interface RunEntry {
	eventId: string;
	title: string;
	startDate: string | null;
	amountOwed: number;
	amountPaid: number | null;
	paid: boolean;
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

	const load = useCallback(async () => {
		const res = await fetch(`/api/players/${params.id}`);
		if (res.ok) {
			const data = await res.json();
			setPlayer(data);
			setNameVal(data.displayName ?? "");
			setNotesVal(data.notes ?? "");
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
		amountOwed: number,
		amountPaid: number | null,
	) => {
		await fetch(`/api/runs/${eventId}/payments`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				userId: params.id,
				amount: amountOwed,
				amountPaid,
			}),
		});
		setPlayer((prev) => {
			if (!prev) return prev;
			const updatedRuns = prev.runs.map((r) =>
				r.eventId === eventId
					? { ...r, amountPaid, paid: amountPaid != null }
					: r,
			);
			const newBalance = updatedRuns.reduce(
				(sum, r) => sum + (r.amountPaid ?? 0) - r.amountOwed,
				0,
			);
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
		const name = player.displayName ?? player.name;
		const owed = Math.abs(player.balance).toFixed(2);
		const runCount = player.runs.filter((r) => !r.paid).length;
		const msg = `Hey ${name}, you owe $${owed} from ${runCount} run${runCount !== 1 ? "s" : ""}. Venmo/e-transfer whenever!`;
		await navigator.clipboard.writeText(msg);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	if (loading) return <p className="text-muted-foreground">Loading...</p>;
	if (!player) return <p className="text-destructive">Player not found</p>;

	const displayName = player.displayName ?? player.name;

	return (
		<div className="space-y-6">
			<Link
				href="/players"
				className="text-sm text-muted-foreground hover:text-foreground"
			>
				← Players
			</Link>

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
						<p className="text-sm text-muted-foreground">
							Partiful: {player.name}
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

			{(player.currentStreak > 1 || player.bestStreak > 1) && (
				<div className="flex gap-4 text-sm text-muted-foreground">
					{player.currentStreak > 1 && (
						<span>🔥 {player.currentStreak} run streak</span>
					)}
					{player.bestStreak > player.currentStreak && (
						<span>Best: {player.bestStreak}</span>
					)}
				</div>
			)}

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
	striped,
	onRecord,
}: {
	run: RunEntry;
	striped: boolean;
	onRecord: (
		eventId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => void;
}) {
	const [editingAmount, setEditingAmount] = useState(false);
	const [customAmount, setCustomAmount] = useState("");

	const date = run.startDate
		? new Date(run.startDate).toLocaleDateString("en-CA", {
				month: "short",
				day: "numeric",
				year: "numeric",
				timeZone: "America/Toronto",
			})
		: "—";

	const status = !run.paid
		? "unpaid"
		: run.amountPaid != null && run.amountPaid !== run.amountOwed
			? "partial"
			: "paid";

	return (
		<tr className={striped ? "bg-muted/30" : "bg-background"}>
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
				<Badge
					variant={
						status === "paid"
							? "default"
							: status === "partial"
								? "secondary"
								: "outline"
					}
				>
					{status}
				</Badge>
			</td>
			<td className="px-4 py-2 text-right">
				{editingAmount ? (
					<div className="flex items-center gap-1 justify-end">
						<input
							type="number"
							value={customAmount}
							onChange={(e) => setCustomAmount(e.target.value)}
							className="w-16 border rounded px-1 py-0.5 text-xs"
							placeholder={run.amountOwed.toFixed(2)}
							autoFocus
						/>
						<Button
							size="sm"
							onClick={() => {
								onRecord(
									run.eventId,
									run.amountOwed,
									parseFloat(customAmount) || run.amountOwed,
								);
								setEditingAmount(false);
							}}
						>
							✓
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setEditingAmount(false)}
						>
							✕
						</Button>
					</div>
				) : (
					<div className="flex items-center gap-1 justify-end">
						{!run.paid && (
							<button
								onClick={() => setEditingAmount(true)}
								className="text-xs text-muted-foreground underline decoration-dotted"
							>
								custom
							</button>
						)}
						<Button
							size="sm"
							variant={run.paid ? "default" : "outline"}
							onClick={() =>
								onRecord(
									run.eventId,
									run.amountOwed,
									run.paid ? null : run.amountOwed,
								)
							}
						>
							{run.paid ? "✓ Paid" : "Mark Paid"}
						</Button>
					</div>
				)}
			</td>
		</tr>
	);
}

function MobileRunCard({
	run,
	onRecord,
}: {
	run: RunEntry;
	onRecord: (
		eventId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => void;
}) {
	const [editingAmount, setEditingAmount] = useState(false);
	const [customAmount, setCustomAmount] = useState("");

	const date = run.startDate
		? new Date(run.startDate).toLocaleDateString("en-CA", {
				month: "short",
				day: "numeric",
				year: "numeric",
				timeZone: "America/Toronto",
			})
		: "—";

	const status = !run.paid
		? "unpaid"
		: run.amountPaid != null && run.amountPaid !== run.amountOwed
			? "partial"
			: "paid";

	return (
		<div className="rounded-lg border px-4 py-3 space-y-2">
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
				<Badge
					variant={
						status === "paid"
							? "default"
							: status === "partial"
								? "secondary"
								: "outline"
					}
				>
					{status}
				</Badge>
			</div>
			<div className="flex items-center gap-3 text-sm text-muted-foreground">
				<span>Owed: ${run.amountOwed.toFixed(2)}</span>
				{run.amountPaid != null && (
					<span>Paid: ${run.amountPaid.toFixed(2)}</span>
				)}
			</div>
			<div className="flex items-center gap-2">
				{editingAmount ? (
					<>
						<input
							type="number"
							value={customAmount}
							onChange={(e) => setCustomAmount(e.target.value)}
							className="w-20 border rounded px-2 py-0.5 text-sm"
							placeholder={run.amountOwed.toFixed(2)}
							autoFocus
						/>
						<Button
							size="sm"
							onClick={() => {
								onRecord(
									run.eventId,
									run.amountOwed,
									parseFloat(customAmount) || run.amountOwed,
								);
								setEditingAmount(false);
							}}
						>
							Save
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setEditingAmount(false)}
						>
							✕
						</Button>
					</>
				) : (
					<>
						{!run.paid && (
							<button
								onClick={() => setEditingAmount(true)}
								className="text-xs text-muted-foreground underline decoration-dotted"
							>
								custom
							</button>
						)}
						<Button
							size="sm"
							variant={run.paid ? "default" : "outline"}
							onClick={() =>
								onRecord(
									run.eventId,
									run.amountOwed,
									run.paid ? null : run.amountOwed,
								)
							}
						>
							{run.paid ? "✓ Paid" : "Mark Paid"}
						</Button>
					</>
				)}
			</div>
		</div>
	);
}
