"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

interface Run { eventId: string; title: string; startDate: string; amountOwed: number; plusOneUserId: string | null }
interface Player { userId: string; name: string; displayName: string | null; unpaidRuns: Run[] }
interface Receipt {
	id: number; senderName: string; amount: number; transferDate: string; status: string;
	unallocatedAmount: number; mappedUserId: string | null; mappedPlayerName: string | null;
}

function exactSuggestion(runs: Run[], amount: number) {
	const eligible = runs.slice(0, 15);
	for (let mask = 1; mask < 1 << eligible.length; mask++) {
		let total = 0;
		for (let i = 0; i < eligible.length; i++) if (mask & (1 << i)) total += eligible[i].amountOwed;
		if (Math.abs(total - amount) < 0.005) return eligible.filter((_, i) => mask & (1 << i));
	}
	return [] as Run[];
}

export function GmailReceipts() {
	const [status, setStatus] = useState<{ connected: boolean; email: string | null; label: string } | null>(null);
	const [receipts, setReceipts] = useState<Receipt[]>([]);
	const [players, setPlayers] = useState<Player[]>([]);
	const [selected, setSelected] = useState<Record<number, string[]>>({});
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		const [statusRes, receiptRes, playerRes] = await Promise.all([fetch("/api/gmail/status"), fetch("/api/gmail/receipts"), fetch("/api/reconcile")]);
		if (statusRes.ok) setStatus(await statusRes.json());
		if (receiptRes.ok) setReceipts((await receiptRes.json()).receipts);
		if (playerRes.ok) setPlayers((await playerRes.json()).players);
	}, []);
	useEffect(() => { load(); }, [load]);

	const fees = useMemo(() => players.flatMap((player) => player.unpaidRuns.map((run) => ({
		key: `${run.plusOneUserId ?? player.userId}:${run.eventId}`,
		eventId: run.eventId, userId: run.plusOneUserId ?? player.userId, amountOwed: run.amountOwed,
		label: `${player.displayName ?? player.name}${run.plusOneUserId ? " (+1)" : ""} — ${run.title}`,
	}))), [players]);

	const setMapping = async (receipt: Receipt, userId: string) => {
		setError(null);
		const res = await fetch("/api/gmail/mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderName: receipt.senderName, userId }) });
		if (!res.ok) setError((await res.json()).error ?? "Could not save sender mapping");
		else {
			const suggested = exactSuggestion(players.find((p) => p.userId === userId)?.unpaidRuns ?? [], receipt.amount)
				.map((run) => `${run.plusOneUserId ?? userId}:${run.eventId}`);
			setSelected((current) => ({ ...current, [receipt.id]: suggested }));
			load();
		}
	};

	const apply = async (receipt: Receipt) => {
		const allocations = fees.filter((fee) => (selected[receipt.id] ?? []).includes(fee.key)).map(({ eventId, userId, amountOwed }) => ({ eventId, userId, amountOwed }));
		setError(null);
		const res = await fetch(`/api/gmail/receipts/${receipt.id}/apply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allocations }) });
		if (!res.ok) setError((await res.json()).error ?? "Could not apply receipt");
		else load();
	};
	const disconnect = async () => {
		await fetch("/api/gmail/status", { method: "DELETE" });
		setReceipts([]);
		load();
	};
	const dismiss = async (receipt: Receipt) => {
		setError(null);
		const res = await fetch(`/api/gmail/receipts/${receipt.id}/dismiss`, { method: "POST" });
		if (!res.ok) setError((await res.json()).error ?? "Could not dismiss receipt");
		else load();
	};

	if (!status) return null;
	return <section className="rounded-lg border p-4 space-y-4">
		<div className="flex items-start justify-between gap-3 flex-wrap">
			<div><h2 className="font-semibold">Gmail e-Transfer receipts</h2><p className="text-sm text-muted-foreground">Only mail automatically labeled “{status.label}” in Gmail is read. Imported transfers always wait for approval.</p></div>
			{status.connected ? <span className="flex gap-2 items-center text-sm text-green-700">Connected: {status.email}<Button size="sm" variant="outline" onClick={disconnect}>Disconnect</Button></span> : <a href="/api/gmail/connect"><Button>Connect Gmail</Button></a>}
		</div>
		{status.connected && <p className="text-xs text-muted-foreground">New receipts are imported by the home-server schedule. The first sync includes labeled messages from your first tracked event onward.</p>}
		{error && <p className="text-sm text-destructive">{error}</p>}
		{receipts.filter((r) => r.status !== "applied" && r.status !== "dismissed").map((receipt) => {
			const selectedFees = fees.filter((fee) => (selected[receipt.id] ?? []).includes(fee.key));
			const total = selectedFees.reduce((sum, fee) => sum + fee.amountOwed, 0);
			return <div key={receipt.id} className="border rounded p-3 space-y-3 text-sm">
				<div className="flex justify-between gap-2 flex-wrap"><span><strong>{receipt.senderName}</strong> · {receipt.transferDate}{receipt.status === "partial" && " · partially allocated"}</span><span className="font-semibold">${receipt.unallocatedAmount.toFixed(2)} remaining of ${receipt.amount.toFixed(2)}</span></div>
				<label className="block">Sender mapping <select className="ml-2 border rounded px-2 py-1" value={receipt.mappedUserId ?? ""} onChange={(e) => e.target.value && setMapping(receipt, e.target.value)}><option value="">Map sender…</option>{players.map((p) => <option key={p.userId} value={p.userId}>{p.displayName ?? p.name}</option>)}</select></label>
				<div className="space-y-1 max-h-48 overflow-y-auto">{fees.map((fee) => <label key={fee.key} className="flex gap-2 items-center"><input type="checkbox" checked={(selected[receipt.id] ?? []).includes(fee.key)} onChange={(e) => setSelected((current) => ({ ...current, [receipt.id]: e.target.checked ? [...(current[receipt.id] ?? []), fee.key] : (current[receipt.id] ?? []).filter((key) => key !== fee.key) }))} /> <span className="flex-1">{fee.label}</span><span>${fee.amountOwed.toFixed(2)}</span></label>)}</div>
				<div className="flex items-center justify-between gap-3"><span className={total > receipt.unallocatedAmount + 0.005 ? "text-destructive" : "text-muted-foreground"}>Selected ${total.toFixed(2)} · remaining ${(receipt.unallocatedAmount - total).toFixed(2)}</span><span className="flex gap-2"><Button size="sm" variant="outline" onClick={() => dismiss(receipt)}>Dismiss</Button><Button size="sm" disabled={!selectedFees.length || total > receipt.unallocatedAmount + 0.005} onClick={() => apply(receipt)}>Approve selected fees</Button></span></div>
			</div>;
		})}
		{status.connected && !receipts.some((r) => r.status !== "applied" && r.status !== "dismissed") && <p className="text-sm text-muted-foreground">No receipts awaiting review.</p>}
	</section>;
}
