"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PaymentAuditAction } from "@/lib/db";
import Link from "next/link";

interface Payment {
	amount: number;
	amountPaid: number | null;
	paid: boolean;
	method: string | null;
	note: string | null;
}

interface Guest {
	userId: string;
	name: string;
	partifulName: string;
	rsvpStatus: string;
	priorBalance: number;
	payment: Payment;
	plusOneOf: string | null;
	isAnonPlusOne: boolean;
}

interface Run {
	eventId: string;
	title: string;
	displayTitle: string | null;
	startDate: string | null;
	capacity: number | null;
	totalCost: number | null;
	splitCount: number;
	costPerHead: number | null;
	notes: string | null;
	syncedAt: string | null;
	hostUserId: string | null;
	guests: Guest[];
}

interface Preset {
	name: string;
	totalCost: number;
	splitCount: number;
}

interface AuditLogEntry {
	id: number;
	userId: string;
	action: PaymentAuditAction;
	amountPaid: number | null;
	changedAt: string;
	playerName: string;
}

interface PlayerBasic {
	userId: string;
	name: string;
	displayName: string | null;
}

export default function RunPage({ params }: { params: { id: string } }) {
	const [run, setRun] = useState<Run | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [loading, setLoading] = useState(true);
	const [presets, setPresets] = useState<Preset[]>([]);
	const [showAddGuest, setShowAddGuest] = useState(false);
	const [newGuestName, setNewGuestName] = useState("");
	const [allPlayers, setAllPlayers] = useState<PlayerBasic[]>([]);
	const [activeTab, setActiveTab] = useState<"guests" | "payments">("guests");
	const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
	const [auditLogLoaded, setAuditLogLoaded] = useState(false);
	const [auditLogOpen, setAuditLogOpen] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleVal, setTitleVal] = useState("");
	const [reminderCopied, setReminderCopied] = useState(false);

	const loadAuditLog = useCallback(
		async (force = false) => {
			if (auditLogLoaded && !force) return;
			try {
				const res = await fetch(`/api/runs/${params.id}/audit-log`);
				if (res.ok) {
					setAuditLog(await res.json());
				}
			} catch {
				// silently leave existing entries, log will refresh on next open
			} finally {
				setAuditLogLoaded(true);
			}
		},
		[params.id, auditLogLoaded],
	);

	const sync = useCallback(async () => {
		setSyncing(true);
		try {
			const runsData = await fetch("/api/runs").then((r) => r.json());
			const all = [...runsData.upcoming, ...runsData.past];
			const event = all.find((e: any) => e.id === params.id);
			if (event) {
				await fetch(`/api/runs/${params.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						title: event.title,
						startDate: event.startDate,
					}),
				});
			}
			await fetch(`/api/runs/${params.id}/sync`, { method: "POST" });
			const res = await fetch(`/api/runs/${params.id}`);
			if (res.ok) setRun(await res.json());
		} finally {
			setSyncing(false);
		}
	}, [params.id]);

	const load = useCallback(async () => {
		const [runRes, presetsRes] = await Promise.all([
			fetch(`/api/runs/${params.id}`),
			fetch("/api/settings?key=costPresets"),
		]);
		if (runRes.ok) {
			setRun(await runRes.json());
		} else {
			await sync();
		}
		if (presetsRes.ok) setPresets(await presetsRes.json());
		setLoading(false);
	}, [params.id, sync]);

	useEffect(() => {
		load();
	}, [load]);

	const recordPayment = async (
		userId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => {
		await fetch(`/api/runs/${params.id}/payments`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ userId, amount: amountOwed, amountPaid }),
		});
		setAuditLogLoaded(false);
		if (auditLogOpen) {
			loadAuditLog(true);
		}
		setRun((prev) =>
			prev
				? {
						...prev,
						guests: prev.guests.map((g) =>
							g.userId === userId
								? {
										...g,
										payment: {
											...g.payment,
											amount: amountOwed,
											amountPaid,
											paid: amountPaid != null,
										},
									}
								: g,
						),
					}
				: prev,
		);
	};

	const updateCost = async (totalCost: number, splitCount: number) => {
		await fetch(`/api/runs/${params.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ totalCost, splitCount }),
		});
		setRun((prev) =>
			prev
				? {
						...prev,
						totalCost,
						splitCount,
						costPerHead: totalCost / splitCount,
					}
				: prev,
		);
	};

	const updateNotes = async (notes: string) => {
		await fetch(`/api/runs/${params.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ notes }),
		});
		setRun((prev) => (prev ? { ...prev, notes } : prev));
	};

	const updateHost = async (hostUserId: string | null) => {
		const oldHostId = run?.hostUserId ?? null;
		await fetch(`/api/runs/${params.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ hostUserId }),
		});
		setRun((prev) => {
			if (!prev) return prev;
			const costPerHead = prev.costPerHead ?? 0;
			return {
				...prev,
				hostUserId,
				guests: prev.guests.map((g) => {
					if (g.userId === hostUserId) {
						return {
							...g,
							payment: {
								...g.payment,
								amountPaid: g.payment?.amount ?? costPerHead,
							},
						};
					}
					if (
						g.userId === oldHostId &&
						g.payment?.amountPaid === (g.payment?.amount ?? costPerHead)
					) {
						return { ...g, payment: { ...g.payment, amountPaid: null } };
					}
					return g;
				}),
			};
		});
	};

	const updateDisplayTitle = async (displayTitle: string | null) => {
		await fetch(`/api/runs/${params.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ displayTitle }),
		});
		setRun((prev) => (prev ? { ...prev, displayTitle } : prev));
		setEditingTitle(false);
	};

	const copyEventReminder = async () => {
		if (!run) return;
		const price =
			run.costPerHead != null ? `$${run.costPerHead.toFixed(2)}` : "the cost";
		const msg = `Hi all, please etransfer kevingeng33@gmail.com ${price}! Thanks!`;
		await navigator.clipboard.writeText(msg);
		setReminderCopied(true);
		setTimeout(() => setReminderCopied(false), 2000);
	};

	const savePreset = async () => {
		if (!run?.totalCost) return;
		const name = window.prompt('Preset name (e.g. "Weekday $90 / 12"):');
		if (!name) return;
		const newPresets = [
			...presets,
			{ name, totalCost: run.totalCost, splitCount: run.splitCount },
		];
		await fetch("/api/settings", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: "costPresets", value: newPresets }),
		});
		setPresets(newPresets);
	};

	const addPlusOne = async (hostUserId: string) => {
		await fetch(`/api/runs/${params.id}/plus-one`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ hostUserId }),
		});
		const res = await fetch(`/api/runs/${params.id}`);
		if (res.ok) setRun(await res.json());
	};

	const removePlusOne = async (plusOneUserId: string) => {
		await fetch(`/api/runs/${params.id}/plus-one`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ plusOneUserId }),
		});
		const res = await fetch(`/api/runs/${params.id}`);
		if (res.ok) setRun(await res.json());
	};

	const openAddGuest = async () => {
		setShowAddGuest(true);
		if (allPlayers.length === 0) {
			const res = await fetch("/api/players");
			if (res.ok) setAllPlayers(await res.json());
		}
	};

	const addGuest = async (userId?: string) => {
		const body = userId ? { userId } : { name: newGuestName.trim() };
		if (!userId && !newGuestName.trim()) return;
		await fetch(`/api/runs/${params.id}/guests`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		setNewGuestName("");
		setShowAddGuest(false);
		const res = await fetch(`/api/runs/${params.id}`);
		if (res.ok) setRun(await res.json());
	};

	if (loading) return <p className="text-muted-foreground">Loading...</p>;
	if (!run) return <p className="text-destructive">Run not found</p>;

	const going = run.guests.filter((g) => g.rsvpStatus === "GOING");
	const maybe = run.guests.filter((g) => g.rsvpStatus === "MAYBE");
	const waitlist = run.guests.filter((g) => g.rsvpStatus === "WAITLIST");
	const other = run.guests.filter(
		(g) => !["GOING", "MAYBE", "WAITLIST"].includes(g.rsvpStatus),
	);
	const paid = going.filter((g) => g.payment?.amountPaid != null);
	const costPerHead = run.costPerHead ?? 0;

	// Separate primary guests from +1s and build host → plusOnes map
	// A +1 whose host is not in GOING is treated as primary so it always appears.
	const primaryGoingIds = new Set(
		going.filter((g) => !g.plusOneOf).map((g) => g.userId),
	);
	const primaryGoing = going.filter(
		(g) => !g.plusOneOf || !primaryGoingIds.has(g.plusOneOf),
	);
	const plusOneMap = new Map<string, Guest[]>();
	for (const g of going) {
		if (g.plusOneOf) {
			const list = plusOneMap.get(g.plusOneOf) ?? [];
			list.push(g);
			plusOneMap.set(g.plusOneOf, list);
		}
	}

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
				<div className="space-y-1">
					{editingTitle ? (
						<div className="flex items-center gap-2">
							<input
								value={titleVal}
								onChange={(e) => setTitleVal(e.target.value)}
								className="text-2xl font-bold border-b border-input bg-transparent outline-none"
								autoFocus
								onKeyDown={(e) => {
									if (e.key === "Enter")
										updateDisplayTitle(titleVal.trim() || null);
									if (e.key === "Escape") setEditingTitle(false);
								}}
							/>
							<Button
								size="sm"
								onClick={() => updateDisplayTitle(titleVal.trim() || null)}
							>
								Save
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setEditingTitle(false)}
							>
								✕
							</Button>
						</div>
					) : (
						<h1
							className="text-2xl font-bold cursor-pointer hover:underline decoration-dotted"
							onClick={() => {
								setTitleVal(run.displayTitle ?? "");
								setEditingTitle(true);
							}}
							title="Click to set custom display name"
						>
							{run.displayTitle ?? run.title}
						</h1>
					)}
					{run.displayTitle && (
						<p className="text-xs text-muted-foreground">
							Partiful: {run.title}
						</p>
					)}
					<p className="text-muted-foreground text-sm">
						{run.startDate
							? new Date(run.startDate).toLocaleDateString("en-CA", {
									weekday: "long",
									year: "numeric",
									month: "long",
									day: "numeric",
									hour: "numeric",
									minute: "2-digit",
									timeZone: "America/Toronto",
								})
							: "Date TBD"}
					</p>
					<NotesField value={run.notes} onSave={updateNotes} />
				</div>
				<div className="flex gap-2 self-start flex-wrap justify-end">
					{run.costPerHead != null && (
						<Button onClick={copyEventReminder} variant="outline" size="sm">
							{reminderCopied ? "Copied!" : "Copy reminder"}
						</Button>
					)}
					<a
						href={`https://partiful.com/events/${run.eventId}`}
						target="_blank"
						rel="noopener noreferrer"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						View on Partiful
					</a>
					<Button onClick={sync} disabled={syncing} variant="outline" size="sm">
						{syncing ? "Syncing..." : "Sync Partiful"}
					</Button>
				</div>
			</div>

			{/* Compact stats */}
			<div className="flex gap-5 text-sm">
				<div className="flex items-baseline gap-1.5">
					<span className="text-muted-foreground">Going</span>
					<span className="font-semibold text-base">
						{going.length}
						{run.capacity ? ` / ${run.capacity}` : ""}
					</span>
				</div>
				<div className="w-px bg-border" />
				<div className="flex items-baseline gap-1.5">
					<span className="text-muted-foreground">Paid</span>
					<span className="font-semibold text-base">
						{paid.length} / {going.length}
					</span>
				</div>
			</div>

			{/* Custom tab nav */}
			<div className="space-y-4">
				<div className="flex border-b">
					<button
						onClick={() => setActiveTab("guests")}
						className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
							activeTab === "guests"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground"
						}`}
					>
						Guest List
					</button>
					<button
						onClick={() => setActiveTab("payments")}
						className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
							activeTab === "payments"
								? "border-foreground text-foreground"
								: "border-transparent text-muted-foreground hover:text-foreground"
						}`}
					>
						Payments
					</button>
				</div>

				{activeTab === "guests" && (
					<div className="space-y-3">
						{going.length > 0 && (
							<div className="rounded-lg border overflow-hidden divide-y">
								{primaryGoing.map((guest) => {
									const plusOnes = plusOneMap.get(guest.userId) ?? [];
									return (
										<Fragment key={guest.userId}>
											<GuestRow
												guest={guest}
												costPerHead={costPerHead}
												onRecord={recordPayment}
												plusOneCount={plusOnes.length}
												onAddPlusOne={addPlusOne}
											/>
											{plusOnes.map((p1) => (
												<GuestRow
													key={p1.userId}
													guest={p1}
													costPerHead={costPerHead}
													onRecord={recordPayment}
													isSubRow
													onRemovePlusOne={removePlusOne}
												/>
											))}
										</Fragment>
									);
								})}
							</div>
						)}

						{(maybe.length > 0 || waitlist.length > 0 || other.length > 0) && (
							<div className="rounded-lg border overflow-hidden divide-y opacity-60">
								{maybe.map((guest) => (
									<NonGoingGuestRow key={guest.userId} guest={guest} />
								))}
								{waitlist.map((guest) => (
									<NonGoingGuestRow key={guest.userId} guest={guest} />
								))}
								{other.map((guest) => (
									<NonGoingGuestRow key={guest.userId} guest={guest} />
								))}
							</div>
						)}

						<div>
							{showAddGuest ? (
								<AddGuestForm
									query={newGuestName}
									onQueryChange={setNewGuestName}
									allPlayers={allPlayers}
									currentGuestIds={new Set(run.guests.map((g) => g.userId))}
									onSelectExisting={(userId) => addGuest(userId)}
									onAddNew={() => addGuest()}
									onCancel={() => {
										setShowAddGuest(false);
										setNewGuestName("");
									}}
								/>
							) : (
								<Button variant="outline" size="sm" onClick={openAddGuest}>
									+ Add Guest
								</Button>
							)}
						</div>
					</div>
				)}

				{activeTab === "payments" && (
					<div className="space-y-3">
						<CostSection
							totalCost={run.totalCost}
							splitCount={run.splitCount}
							presets={presets}
							onUpdate={updateCost}
							onSavePreset={savePreset}
							onApplyPreset={(p) => updateCost(p.totalCost, p.splitCount)}
						/>
						<HostSection
							hostUserId={run.hostUserId}
							going={going.filter((g) => !g.isAnonPlusOne)}
							onUpdate={updateHost}
						/>
						{going.length > 0 && (
							<div className="rounded-lg border overflow-hidden divide-y">
								{primaryGoing.map((guest) => {
									const plusOnes = plusOneMap.get(guest.userId) ?? [];
									return (
										<Fragment key={guest.userId}>
											<PaymentRow
												guest={guest}
												costPerHead={costPerHead}
												onRecord={recordPayment}
												plusOneCount={plusOnes.length}
											/>
											{plusOnes.map((p1) => (
												<PaymentRow
													key={p1.userId}
													guest={p1}
													costPerHead={costPerHead}
													onRecord={recordPayment}
													isSubRow
												/>
											))}
										</Fragment>
									);
								})}
							</div>
						)}
					</div>
				)}
			</div>

			<PaymentHistorySection
				entries={auditLog}
				loaded={auditLogLoaded}
				open={auditLogOpen}
				onToggle={() => {
					if (!auditLogOpen) loadAuditLog();
					setAuditLogOpen((v) => !v);
				}}
			/>

			{run.syncedAt && (
				<p className="text-xs text-muted-foreground">
					Last synced: {new Date(run.syncedAt).toLocaleString()}
				</p>
			)}
		</div>
	);
}

function AddGuestForm({
	query,
	onQueryChange,
	allPlayers,
	currentGuestIds,
	onSelectExisting,
	onAddNew,
	onCancel,
}: {
	query: string;
	onQueryChange: (v: string) => void;
	allPlayers: { userId: string; name: string; displayName: string | null }[];
	currentGuestIds: Set<string>;
	onSelectExisting: (userId: string) => void;
	onAddNew: () => void;
	onCancel: () => void;
}) {
	const q = query.trim().toLowerCase();
	const suggestions = q
		? allPlayers.filter((p) => {
				if (currentGuestIds.has(p.userId)) return false;
				const display = (p.displayName ?? p.name).toLowerCase();
				const partiful = p.name.toLowerCase();
				return display.includes(q) || partiful.includes(q);
			})
		: [];

	return (
		<div className="space-y-1">
			<div className="flex gap-2">
				<input
					value={query}
					onChange={(e) => onQueryChange(e.target.value)}
					placeholder="Search players or enter new name"
					className="border rounded px-2 py-1 text-sm flex-1 min-w-0"
					autoFocus
					onKeyDown={(e) => {
						if (e.key === "Escape") onCancel();
					}}
				/>
				<Button size="sm" variant="ghost" onClick={onCancel}>
					✕
				</Button>
			</div>
			{q && (
				<div className="border rounded overflow-hidden text-sm">
					{suggestions.map((p) => (
						<button
							key={p.userId}
							className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2"
							onClick={() => onSelectExisting(p.userId)}
						>
							<span className="font-medium">{p.displayName ?? p.name}</span>
							{p.displayName && (
								<span className="text-muted-foreground text-xs">{p.name}</span>
							)}
						</button>
					))}
					<button
						className="w-full text-left px-3 py-2 hover:bg-muted text-muted-foreground"
						onClick={onAddNew}
					>
						+ Add &ldquo;{query.trim()}&rdquo; as new player
					</button>
				</div>
			)}
		</div>
	);
}

function GuestRow({
	guest,
	costPerHead,
	onRecord,
	plusOneCount = 0,
	isSubRow = false,
	onAddPlusOne,
	onRemovePlusOne,
}: {
	guest: Guest;
	costPerHead: number;
	onRecord: (
		userId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => void;
	plusOneCount?: number;
	isSubRow?: boolean;
	onAddPlusOne?: (hostUserId: string) => void;
	onRemovePlusOne?: (plusOneUserId: string) => void;
}) {
	const amountOwed = guest.payment?.amount ?? costPerHead;
	const isPaid = guest.payment?.amountPaid != null;
	return (
		<div
			className={cn(
				"flex items-center px-4 py-2.5 gap-3 bg-background",
				isSubRow && "pl-10",
			)}
		>
			<Button
				variant={isPaid ? "default" : "outline"}
				size="sm"
				onClick={() =>
					onRecord(guest.userId, amountOwed, isPaid ? null : amountOwed)
				}
			>
				{isPaid ? "✓ Paid" : "Mark Paid"}
			</Button>
			<div className="flex items-center gap-2.5">
				<Link
					href={`/players/${guest.userId}`}
					className="font-medium hover:underline"
					onClick={(e) => e.stopPropagation()}
				>
					{guest.name}
				</Link>
				{plusOneCount > 0 && (
					<span className="text-xs text-muted-foreground">
						(+{plusOneCount})
					</span>
				)}
				{guest.userId.startsWith("manual-") && (
					<span className="text-xs text-muted-foreground bg-muted px-1 rounded">
						manual
					</span>
				)}
			</div>
			<div className="ml-auto">
				{isSubRow && onRemovePlusOne && (
					<button
						onClick={() => onRemovePlusOne(guest.userId)}
						className="text-xs text-muted-foreground hover:text-destructive transition-colors px-1"
						title="Remove this +1"
					>
						×
					</button>
				)}
				{!isSubRow && onAddPlusOne && (
					<button
						onClick={() => onAddPlusOne(guest.userId)}
						className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
						title="Add +1"
					>
						+1
					</button>
				)}
			</div>
		</div>
	);
}

function NonGoingGuestRow({ guest }: { guest: Guest }) {
	return (
		<div className="flex items-center px-4 py-2.5 gap-2.5 bg-background">
			<Link
				href={`/players/${guest.userId}`}
				className="font-medium hover:underline"
			>
				{guest.name}
			</Link>
			<RsvpBadge status={guest.rsvpStatus} />
			{guest.userId.startsWith("manual-") && (
				<span className="text-xs text-muted-foreground bg-muted px-1 rounded">
					manual
				</span>
			)}
		</div>
	);
}

function HostSection({
	hostUserId,
	going,
	onUpdate,
}: {
	hostUserId: string | null;
	going: Guest[];
	onUpdate: (hostUserId: string | null) => void;
}) {
	return (
		<div className="flex items-center gap-3 flex-wrap text-sm">
			<span className="text-muted-foreground">Host:</span>
			<select
				value={hostUserId ?? ""}
				onChange={(e) => onUpdate(e.target.value || null)}
				className="border rounded px-2 py-0.5 text-sm"
			>
				<option value="">None</option>
				{going.map((g) => (
					<option key={g.userId} value={g.userId}>
						{g.name}
					</option>
				))}
			</select>
		</div>
	);
}

function PaymentRow({
	guest,
	costPerHead,
	onRecord,
	plusOneCount = 0,
	isSubRow = false,
}: {
	guest: Guest;
	costPerHead: number;
	onRecord: (
		userId: string,
		amountOwed: number,
		amountPaid: number | null,
	) => void;
	plusOneCount?: number;
	isSubRow?: boolean;
}) {
	const [editingAmount, setEditingAmount] = useState(false);
	const [customAmount, setCustomAmount] = useState("");
	const amountOwed = guest.payment?.amount ?? costPerHead;
	const amountPaid = guest.payment?.amountPaid;
	const isPaid = guest.payment?.amountPaid != null;
	const credit = guest.priorBalance ?? 0;

	return (
		<div
			className={cn(
				"flex items-center px-4 py-2.5 gap-3 bg-background",
				isSubRow && "pl-10",
			)}
		>
			{!isPaid && editingAmount ? (
				<>
					<input
						type="number"
						value={customAmount}
						onChange={(e) => setCustomAmount(e.target.value)}
						className="w-20 border rounded px-2 py-0.5 text-sm"
						placeholder={amountOwed.toFixed(2)}
						autoFocus
					/>
					<Button
						size="sm"
						onClick={() => {
							onRecord(
								guest.userId,
								amountOwed,
								parseFloat(customAmount) || amountOwed,
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
					{!isPaid && (
						<button
							onClick={() => setEditingAmount(true)}
							className="text-xs text-muted-foreground underline decoration-dotted"
						>
							custom
						</button>
					)}
					<Button
						variant={isPaid ? "default" : "outline"}
						size="sm"
						onClick={() =>
							onRecord(guest.userId, amountOwed, isPaid ? null : amountOwed)
						}
					>
						{isPaid ? "✓ Paid" : "Mark Paid"}
					</Button>
				</>
			)}
			<div className="flex items-center gap-3">
				<Link
					href={`/players/${guest.userId}`}
					className="font-medium hover:underline"
				>
					{guest.name}
				</Link>
				{plusOneCount > 0 && (
					<span className="text-xs text-muted-foreground">
						(+{plusOneCount})
					</span>
				)}
				<span className="text-sm text-muted-foreground">
					${amountOwed.toFixed(2)}
				</span>
				{isPaid && amountPaid != null && amountPaid !== amountOwed && (
					<span className="text-xs text-muted-foreground">
						(paid ${amountPaid.toFixed(2)})
					</span>
				)}
				{credit > 0 && (
					<span className="text-xs text-green-600 dark:text-green-400">
						credit ${credit.toFixed(2)}
					</span>
				)}
			</div>
		</div>
	);
}

function CostSection({
	totalCost,
	splitCount,
	presets,
	onUpdate,
	onSavePreset,
	onApplyPreset,
}: {
	totalCost: number | null;
	splitCount: number;
	presets: Preset[];
	onUpdate: (t: number, s: number) => void;
	onSavePreset: () => void;
	onApplyPreset: (p: Preset) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [cost, setCost] = useState(String(totalCost ?? ""));
	const [split, setSplit] = useState(String(splitCount));
	useEffect(() => {
		setCost(String(totalCost ?? ""));
		setSplit(String(splitCount));
	}, [totalCost, splitCount]);
	const costPerHead =
		totalCost != null ? (totalCost / splitCount).toFixed(2) : null;

	if (!editing)
		return (
			<div className="flex items-center gap-3 flex-wrap text-sm">
				<span className="text-muted-foreground">Run cost:</span>
				<button
					onClick={() => setEditing(true)}
					className="font-medium underline decoration-dotted"
				>
					{totalCost != null
						? `$${totalCost.toFixed(2)} ÷ ${splitCount}`
						: "Set cost"}
				</button>
				{costPerHead && (
					<span className="text-muted-foreground">= ${costPerHead} / head</span>
				)}
				{presets.length > 0 && (
					<select
						className="text-xs border rounded px-1 py-0.5 text-muted-foreground"
						defaultValue=""
						onChange={(e) => {
							const p = presets[parseInt(e.target.value)];
							if (p) onApplyPreset(p);
							e.target.value = "";
						}}
					>
						<option value="">Apply preset…</option>
						{presets.map((p, i) => (
							<option key={i} value={i}>
								{p.name}
							</option>
						))}
					</select>
				)}
				{totalCost != null && (
					<button
						onClick={onSavePreset}
						className="text-xs text-muted-foreground underline decoration-dotted"
					>
						Save as preset
					</button>
				)}
			</div>
		);

	return (
		<div className="flex flex-wrap items-center gap-2 text-sm">
			<span className="text-muted-foreground">$</span>
			<input
				type="number"
				value={cost}
				onChange={(e) => setCost(e.target.value)}
				className="w-20 border rounded px-2 py-0.5"
				placeholder="120"
				autoFocus
			/>
			<span className="text-muted-foreground">÷</span>
			<input
				type="number"
				value={split}
				onChange={(e) => setSplit(e.target.value)}
				className="w-16 border rounded px-2 py-0.5"
			/>
			<Button
				size="sm"
				onClick={() => {
					onUpdate(parseFloat(cost), parseInt(split) || 12);
					setEditing(false);
				}}
			>
				Save
			</Button>
			<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
				✕
			</Button>
		</div>
	);
}

function NotesField({
	value,
	onSave,
}: {
	value: string | null;
	onSave: (v: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [val, setVal] = useState(value ?? "");
	if (!editing)
		return (
			<p
				className="text-sm text-muted-foreground cursor-pointer hover:text-foreground min-h-[1.25rem]"
				onClick={() => setEditing(true)}
			>
				{value || <em>Add run notes…</em>}
			</p>
		);
	return (
		<div className="flex flex-col gap-2">
			<textarea
				value={val}
				onChange={(e) => setVal(e.target.value)}
				className="w-full border rounded px-2 py-1 text-sm min-h-[60px]"
				autoFocus
			/>
			<div className="flex gap-2">
				<Button
					size="sm"
					onClick={() => {
						onSave(val);
						setEditing(false);
					}}
				>
					Save
				</Button>
				<Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function PaymentHistorySection({
	entries,
	loaded,
	open,
	onToggle,
}: {
	entries: AuditLogEntry[];
	loaded: boolean;
	open: boolean;
	onToggle: () => void;
}) {
	const fmt = (iso: string) =>
		new Date(iso).toLocaleString("en-CA", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone: "America/Toronto",
		});

	return (
		<div className="border rounded-lg overflow-hidden">
			<button
				onClick={onToggle}
				className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
			>
				<span>Payment history</span>
				<span className="text-muted-foreground">{open ? "▲" : "▼"}</span>
			</button>
			{open && (
				<div className="divide-y border-t">
					{!loaded ? (
						<p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
					) : entries.length === 0 ? (
						<p className="px-4 py-3 text-sm text-muted-foreground">
							No payment history yet.
						</p>
					) : (
						entries.map((e) => (
							<div
								key={e.id}
								className="px-4 py-2.5 flex items-baseline gap-3 text-sm"
							>
								<Link
									href={`/players/${e.userId}`}
									className="font-medium hover:underline"
								>
									{e.playerName}
								</Link>
								<span
									className={
										e.action === "marked_paid"
											? "text-green-600 dark:text-green-400"
											: "text-muted-foreground"
									}
								>
									{e.action === "marked_paid" ? "paid" : "unpaid"}
								</span>
								{e.amountPaid != null && (
									<span className="text-muted-foreground">
										${e.amountPaid.toFixed(2)}
									</span>
								)}
								<span className="ml-auto text-xs text-muted-foreground">
									{fmt(e.changedAt)}
								</span>
							</div>
						))
					)}
				</div>
			)}
		</div>
	);
}

function RsvpBadge({ status }: { status: string }) {
	const variants: Record<string, "default" | "secondary" | "destructive"> = {
		GOING: "default",
		MAYBE: "secondary",
		NOT_GOING: "destructive",
	};
	return <Badge variant={variants[status] ?? "secondary"}>{status}</Badge>;
}
