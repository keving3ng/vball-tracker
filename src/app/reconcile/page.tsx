"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface UnpaidRun {
	eventId: string;
	title: string;
	startDate: string;
	amountOwed: number;
	plusOneUserId: string | null; // null = player's own fee, non-null = their +1's fee
}

interface PlayerData {
	userId: string;
	name: string;
	displayName: string | null;
	unpaidRuns: UnpaidRun[];
}

interface ParsedTransaction {
	rawName: string;
	amount: number;
	date: string; // YYYY-MM-DD
}

interface RunAssignment {
	eventId: string;
	title: string;
	startDate: string;
	amountOwed: number;
	userId: string; // player or +1 userId
	isPlusOne: boolean;
}

interface Association {
	txIdx: number;
	transaction: ParsedTransaction;
	userId: string;
	runs: RunAssignment[];
	unmatched: number;
}

// ── Parser ────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
	January: 0, February: 1, March: 2, April: 3,
	May: 4, June: 5, July: 6, August: 7,
	September: 8, October: 9, November: 10, December: 11,
};
const MONTH_NAMES = Object.keys(MONTHS).join("|");

function parseBankLog(text: string): ParsedTransaction[] {
	const lines = text.split("\n");
	const transactions: ParsedTransaction[] = [];
	let currentDate: string | null = null;
	const now = new Date();

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const trimmed = raw.trim();

		const dateMatch = trimmed.match(
			new RegExp(`^(${MONTH_NAMES})\\s+(\\d{1,2})$`),
		);
		if (dateMatch) {
			const month = MONTHS[dateMatch[1]];
			const day = parseInt(dateMatch[2]);
			let year = now.getFullYear();
			const candidate = new Date(year, month, day);
			if (candidate.getTime() - now.getTime() > 90 * 24 * 60 * 60 * 1000)
				year--;
			currentDate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
			continue;
		}

		const transferMatch = trimmed.match(/^Interac e-Transfer From:\s+(.+)$/);
		if (transferMatch && currentDate) {
			const rawName = transferMatch[1].trim();
			let amount: number | null = null;

			for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
				const next = lines[j];
				// Indented lines are running balance — skip
				if (next.startsWith("\t") || /^\s{2,}/.test(next)) continue;
				const t = next.trim();
				if (!t) continue;
				// Stop if we hit another date/transfer
				if (new RegExp(`^(${MONTH_NAMES})\\s+\\d`).test(t)) break;
				if (t.startsWith("Interac e-Transfer")) break;
				const amtMatch = t.match(/^\$([\d,]+\.?\d*)$/);
				if (amtMatch) {
					amount = parseFloat(amtMatch[1].replace(/,/g, ""));
					break;
				}
			}

			if (amount != null && amount > 0) {
				transactions.push({ date: currentDate, rawName, amount });
			}
		}
	}

	return transactions;
}

// ── Name auto-matching ────────────────────────────────────────────────────────

function autoMatchName(rawName: string, players: PlayerData[]): string | null {
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, "").trim();
	const raw = norm(rawName);

	for (const p of players) {
		if (norm(p.displayName ?? p.name) === raw || norm(p.name) === raw)
			return p.userId;
	}

	// Word overlap: require ≥ 50% of raw words to match player words
	let bestId: string | null = null;
	let bestScore = 0;
	const rawWords = raw.split(/\s+/).filter((w) => w.length > 1);

	for (const p of players) {
		const playerWords = new Set([
			...norm(p.name).split(/\s+/),
			...norm(p.displayName ?? "").split(/\s+/),
		]);
		const hits = rawWords.filter((w) => playerWords.has(w)).length;
		const score = hits / Math.max(rawWords.length, 1);
		if (score > bestScore && score >= 0.5) {
			bestScore = score;
			bestId = p.userId;
		}
	}

	return bestId;
}

// ── Subset-sum association ────────────────────────────────────────────────────

function findBestRuns(
	unpaidRuns: UnpaidRun[],
	playerId: string,
	payment: number,
	paymentDate: string,
	tolerance = 5.0,
): RunAssignment[] {
	const eligible = unpaidRuns
		.filter((r) => r.startDate < paymentDate)
		.slice(0, 15);

	if (!eligible.length) return [];

	const n = eligible.length;
	let bestMask = 0;
	let bestDiff = Infinity;
	let bestSize = Infinity;

	for (let mask = 1; mask < 1 << n; mask++) {
		let sum = 0;
		let size = 0;
		for (let i = 0; i < n; i++) {
			if (mask & (1 << i)) {
				sum += eligible[i].amountOwed;
				size++;
			}
		}
		const diff = payment - sum;
		if (diff >= -0.01 && diff <= tolerance) {
			if (
				diff < bestDiff - 0.01 ||
				(Math.abs(diff - bestDiff) < 0.01 && size < bestSize)
			) {
				bestDiff = diff;
				bestSize = size;
				bestMask = mask;
			}
		}
	}

	return eligible
		.filter((_, i) => bestMask & (1 << i))
		.map((r) => ({
			eventId: r.eventId,
			title: r.title,
			startDate: r.startDate,
			amountOwed: r.amountOwed,
			userId: r.plusOneUserId ?? playerId,
			isPlusOne: r.plusOneUserId != null,
		}));
}

// ── Local storage key ─────────────────────────────────────────────────────────

const LS_KEY = "vball-name-mappings";

// ── Main component ────────────────────────────────────────────────────────────

type Step = "input" | "map" | "associate" | "done";

export default function ReconcilePage() {
	const [step, setStep] = useState<Step>("input");
	const [rawText, setRawText] = useState("");
	const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
	const [players, setPlayers] = useState<PlayerData[]>([]);
	const [nameMap, setNameMap] = useState<Record<string, string | "skip">>({});
	const [associations, setAssociations] = useState<Association[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		try {
			const saved = localStorage.getItem(LS_KEY);
			if (saved) setNameMap(JSON.parse(saved));
		} catch {}
	}, []);

	const setAndSaveNameMap = (
		updater: (prev: Record<string, string | "skip">) => Record<string, string | "skip">,
	) => {
		setNameMap((prev) => {
			const next = updater(prev);
			try {
				localStorage.setItem(LS_KEY, JSON.stringify(next));
			} catch {}
			return next;
		});
	};

	const parse = async () => {
		setError(null);
		const txns = parseBankLog(rawText);
		if (!txns.length) {
			setError(
				'No transactions found. Make sure you pasted the full bank log including dates and "Interac e-Transfer From:" lines.',
			);
			return;
		}

		const res = await fetch("/api/reconcile");
		if (!res.ok) {
			setError("Failed to load player data");
			return;
		}
		const data = await res.json();
		const loadedPlayers: PlayerData[] = data.players;
		setPlayers(loadedPlayers);
		setTransactions(txns);

		// Auto-map names not yet in the saved map
		setAndSaveNameMap((prev) => {
			const next = { ...prev };
			for (const tx of txns) {
				if (next[tx.rawName] !== undefined) continue;
				const match = autoMatchName(tx.rawName, loadedPlayers);
				if (match) next[tx.rawName] = match;
			}
			return next;
		});

		setStep("map");
	};

	const buildAssociations = () => {
		const list: Association[] = [];
		for (let txIdx = 0; txIdx < transactions.length; txIdx++) {
			const tx = transactions[txIdx];
			const mapped = nameMap[tx.rawName];
			if (!mapped || mapped === "skip") continue;
			const player = players.find((p) => p.userId === mapped);
			if (!player) continue;

			const runs = findBestRuns(
				player.unpaidRuns,
				player.userId,
				tx.amount,
				tx.date,
			);
			const sum = runs.reduce((s, r) => s + r.amountOwed, 0);
			list.push({ txIdx, transaction: tx, userId: mapped, runs, unmatched: tx.amount - sum });
		}
		setAssociations(list);
		setStep("associate");
	};

	const submit = async () => {
		setSubmitting(true);
		setError(null);
		try {
			const payments = associations.flatMap((a) =>
				a.runs.map((r) => ({
					userId: r.userId,
					eventId: r.eventId,
					amountOwed: r.amountOwed,
				})),
			);
			if (!payments.length) {
				setError("No payments to record.");
				return;
			}
			const res = await fetch("/api/reconcile", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ payments }),
			});
			if (!res.ok) throw new Error(`Server error ${res.status}`);
			setStep("done");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Failed to submit");
		} finally {
			setSubmitting(false);
		}
	};

	const uniqueNames = [...new Set(transactions.map((t) => t.rawName))];
	const unmappedNames = uniqueNames.filter((n) => nameMap[n] === undefined);
	const totalRuns = associations.reduce((s, a) => s + a.runs.length, 0);

	const fmtDate = (iso: string) =>
		new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString(
			"en-CA",
			{ month: "short", day: "numeric", timeZone: "America/Toronto" },
		);

	// ── Render ──────────────────────────────────────────────────────────────────

	if (step === "input") {
		return (
			<div className="space-y-4">
				<h1 className="text-2xl font-bold">Reconcile Payments</h1>
				<p className="text-sm text-muted-foreground">
					Paste your bank transaction log. The tool parses Interac e-Transfer
					entries, matches names to players, and suggests which runs each payment
					covers.
				</p>
				<textarea
					value={rawText}
					onChange={(e) => setRawText(e.target.value)}
					placeholder="Paste bank log here…"
					className="w-full border rounded px-3 py-2 text-sm font-mono min-h-[280px] resize-y"
				/>
				{error && <p className="text-destructive text-sm">{error}</p>}
				<Button onClick={parse} disabled={!rawText.trim()}>
					Parse Transactions
				</Button>
			</div>
		);
	}

	if (step === "map") {
		return (
			<div className="space-y-5">
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-bold">Reconcile Payments</h1>
				</div>
				<div className="flex items-center gap-3 text-sm text-muted-foreground">
					<button
						onClick={() => setStep("input")}
						className="hover:text-foreground"
					>
						← Edit log
					</button>
					<span>·</span>
					<span>{transactions.length} transactions parsed</span>
				</div>

				{unmappedNames.length > 0 && (
					<div className="space-y-2">
						<h2 className="font-semibold text-sm">Map unrecognised names</h2>
						<div className="rounded-lg border overflow-hidden divide-y">
							{unmappedNames.map((name) => (
								<div
									key={name}
									className="flex items-center gap-3 px-4 py-3 flex-wrap"
								>
									<span className="font-mono text-sm flex-1 min-w-0 truncate">
										{name}
									</span>
									<select
										value={nameMap[name] ?? ""}
										onChange={(e) =>
											setAndSaveNameMap((prev) => ({
												...prev,
												[name]: (e.target.value as string | "skip") || undefined as any,
											}))
										}
										className="border rounded px-2 py-1 text-sm"
									>
										<option value="">Select player…</option>
										<option value="skip">Skip (ignore)</option>
										{players
											.sort((a, b) =>
												(a.displayName ?? a.name).localeCompare(
													b.displayName ?? b.name,
												),
											)
											.map((p) => (
												<option key={p.userId} value={p.userId}>
													{p.displayName ?? p.name}
												</option>
											))}
									</select>
								</div>
							))}
						</div>
					</div>
				)}

				<div className="space-y-2">
					<h2 className="font-semibold text-sm">Parsed transactions</h2>
					<div className="rounded-lg border overflow-hidden divide-y text-sm">
						{transactions.map((tx, i) => {
							const mapped = nameMap[tx.rawName];
							const player =
								mapped && mapped !== "skip"
									? players.find((p) => p.userId === mapped)
									: null;
							return (
								<div key={i} className="flex items-center gap-3 px-4 py-2.5">
									<span className="text-muted-foreground w-14 shrink-0">
										{fmtDate(tx.date)}
									</span>
									<span className="font-mono text-xs flex-1 min-w-0 truncate">
										{tx.rawName}
									</span>
									<span className="font-medium shrink-0">
										${tx.amount.toFixed(2)}
									</span>
									<span
										className={`text-xs shrink-0 ${
											player
												? "text-green-600"
												: mapped === "skip"
													? "text-muted-foreground"
													: "text-amber-600"
										}`}
									>
										{player
											? (player.displayName ?? player.name)
											: mapped === "skip"
												? "skip"
												: "⚠ unmapped"}
									</span>
								</div>
							);
						})}
					</div>
				</div>

				<Button
					onClick={buildAssociations}
					disabled={unmappedNames.length > 0}
				>
					{unmappedNames.length > 0
						? `Map ${unmappedNames.length} name${unmappedNames.length !== 1 ? "s" : ""} to continue`
						: "Auto-Associate Payments →"}
				</Button>
			</div>
		);
	}

	if (step === "associate") {
		return (
			<div className="space-y-5">
				<h1 className="text-2xl font-bold">Reconcile Payments</h1>
				<div className="flex items-center gap-3 text-sm text-muted-foreground">
					<button
						onClick={() => setStep("map")}
						className="hover:text-foreground"
					>
						← Back
					</button>
					<span>·</span>
					<span>
						{associations.length} transactions · {totalRuns} run payments
					</span>
				</div>

				<div className="space-y-3">
					{associations.map((assoc) => {
						const player = players.find((p) => p.userId === assoc.userId)!;
						const sum = assoc.runs.reduce((s, r) => s + r.amountOwed, 0);
						return (
							<div key={assoc.txIdx} className="rounded-lg border overflow-hidden">
								{/* Transaction header */}
								<div className="px-4 py-3 bg-muted/30 flex items-start justify-between gap-2 flex-wrap">
									<div>
										<span className="font-semibold">
											{player.displayName ?? player.name}
										</span>
										<span className="text-muted-foreground text-sm ml-2">
											${assoc.transaction.amount.toFixed(2)} on{" "}
											{fmtDate(assoc.transaction.date)}
										</span>
									</div>
									<div className="text-xs shrink-0">
										{Math.abs(assoc.transaction.amount - sum) < 0.01 ? (
											<span className="text-green-600">✓ exact match</span>
										) : assoc.transaction.amount > sum ? (
											<span className="text-amber-600">
												+${(assoc.transaction.amount - sum).toFixed(2)} unmatched
											</span>
										) : (
											<span className="text-destructive">
												over by ${(sum - assoc.transaction.amount).toFixed(2)}
											</span>
										)}
									</div>
								</div>

								{/* Run associations */}
								<div className="divide-y">
									{assoc.runs.length === 0 ? (
										<p className="px-4 py-3 text-sm text-muted-foreground">
											⚠ No runs matched — payment will not be recorded
										</p>
									) : (
										assoc.runs.map((r, ri) => (
											<div
												key={ri}
												className="flex items-center gap-3 px-4 py-2.5 text-sm"
											>
												<span className="text-green-600 shrink-0">✓</span>
												<Link
													href={`/runs/${r.eventId}`}
													className="flex-1 hover:underline truncate"
												>
													{r.title}
													{r.isPlusOne && (
														<span className="ml-1.5 text-xs text-muted-foreground">
															(+1)
														</span>
													)}
												</Link>
												<span className="text-muted-foreground shrink-0">
													{fmtDate(r.startDate)}
												</span>
												<span className="font-medium shrink-0">
													${r.amountOwed.toFixed(2)}
												</span>
											</div>
										))
									)}

									{/* Override / run selector */}
									<RunOverride
										player={player}
										paymentDate={assoc.transaction.date}
										selectedKeys={assoc.runs.map(
											(r) => `${r.userId}:${r.eventId}`,
										)}
										onUpdate={(keys) => {
											setAssociations((prev) =>
												prev.map((a) => {
													if (a.txIdx !== assoc.txIdx) return a;
													const runs = player.unpaidRuns
														.filter((r) =>
															keys.includes(
																`${r.plusOneUserId ?? player.userId}:${r.eventId}`,
															),
														)
														.map((r) => ({
															eventId: r.eventId,
															title: r.title,
															startDate: r.startDate,
															amountOwed: r.amountOwed,
															userId: r.plusOneUserId ?? player.userId,
															isPlusOne: r.plusOneUserId != null,
														}));
													const sum = runs.reduce((s, r) => s + r.amountOwed, 0);
													return {
														...a,
														runs,
														unmatched: a.transaction.amount - sum,
													};
												}),
											);
										}}
										fmtDate={fmtDate}
									/>
								</div>
							</div>
						);
					})}
				</div>

				{error && <p className="text-destructive text-sm">{error}</p>}

				<Button
					onClick={submit}
					disabled={submitting || totalRuns === 0}
				>
					{submitting ? "Applying…" : `Apply ${totalRuns} Payment${totalRuns !== 1 ? "s" : ""}`}
				</Button>
			</div>
		);
	}

	// Done
	return (
		<div className="space-y-4">
			<h1 className="text-2xl font-bold">Reconcile Payments</h1>
			<p className="text-green-600 font-medium">
				✓ {totalRuns} payment{totalRuns !== 1 ? "s" : ""} recorded successfully.
			</p>
			<div className="flex gap-4 items-center">
				<Button
					variant="outline"
					onClick={() => {
						setStep("input");
						setRawText("");
						setTransactions([]);
						setAssociations([]);
					}}
				>
					Reconcile more
				</Button>
				<Link
					href="/"
					className="text-sm text-muted-foreground hover:text-foreground"
				>
					← Dashboard
				</Link>
			</div>
		</div>
	);
}

// ── Override component ────────────────────────────────────────────────────────

function RunOverride({
	player,
	paymentDate,
	selectedKeys,
	onUpdate,
	fmtDate,
}: {
	player: PlayerData;
	paymentDate: string;
	selectedKeys: string[];
	onUpdate: (keys: string[]) => void;
	fmtDate: (s: string) => string;
}) {
	const [open, setOpen] = useState(false);
	const eligible = player.unpaidRuns.filter((r) => r.startDate < paymentDate);

	if (!open) {
		return (
			<div className="px-4 py-2.5">
				<button
					onClick={() => setOpen(true)}
					className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
				>
					Override run selection ({eligible.length} eligible)
				</button>
			</div>
		);
	}

	return (
		<div className="px-4 py-3 space-y-2 bg-muted/10">
			<p className="text-xs font-medium text-muted-foreground">
				Select runs/+1s to mark paid:
			</p>
			<div className="space-y-1">
				{eligible.map((r) => {
					const key = `${r.plusOneUserId ?? player.userId}:${r.eventId}`;
					const checked = selectedKeys.includes(key);
					return (
						<label
							key={key}
							className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded"
						>
							<input
								type="checkbox"
								checked={checked}
								onChange={(e) => {
									const next = e.target.checked
										? [...selectedKeys, key]
										: selectedKeys.filter((k) => k !== key);
									onUpdate(next);
								}}
							/>
							<span className="flex-1 truncate">
								{r.title}
								{r.plusOneUserId && (
									<span className="ml-1 text-muted-foreground">(+1)</span>
								)}
							</span>
							<span className="text-muted-foreground shrink-0">
								{fmtDate(r.startDate)}
							</span>
							<span className="shrink-0">${r.amountOwed.toFixed(2)}</span>
						</label>
					);
				})}
			</div>
			<button
				onClick={() => setOpen(false)}
				className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
			>
				Done
			</button>
		</div>
	);
}
