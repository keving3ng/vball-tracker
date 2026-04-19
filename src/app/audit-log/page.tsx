"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { GlobalPaymentAuditLogRow } from "@/lib/db";

export default function AuditLogPage() {
	const [entries, setEntries] = useState<GlobalPaymentAuditLogRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch("/api/audit-log")
			.then((r) => {
				if (!r.ok) throw new Error(`Failed to load audit log: ${r.status}`);
				return r.json();
			})
			.then(setEntries)
			.catch((e) => setError(e instanceof Error ? e.message : "Unknown error"))
			.finally(() => setLoading(false));
	}, []);

	const fmt = (iso: string) =>
		new Date(iso).toLocaleString("en-CA", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone: "America/Toronto",
		});

	if (loading) return <p className="text-muted-foreground">Loading...</p>;
	if (error) return <p className="text-destructive">Error: {error}</p>;

	return (
		<div className="space-y-4">
			<h1 className="text-2xl font-bold">Payment Audit Log</h1>
			{entries.length === 0 ? (
				<p className="text-muted-foreground">No payment history yet.</p>
			) : (
				<div className="rounded-lg border overflow-hidden divide-y">
					{entries.map((e) => (
						<div
							key={e.id}
							className="px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
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
							<span className="text-muted-foreground">for</span>
							<Link
								href={`/runs/${e.eventId}`}
								className="text-muted-foreground hover:underline hover:text-foreground"
							>
								{e.eventTitle}
							</Link>
							<span className="ml-auto text-xs text-muted-foreground">
								{fmt(e.changedAt)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
