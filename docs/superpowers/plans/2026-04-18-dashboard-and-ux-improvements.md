# Dashboard & UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 14 UX improvements across the dashboard, run detail, and player profile pages — including collapsible outstanding section, redesigned run cards, pagination, clickable player names, global audit log page, custom event names, and reminder templates.

**Architecture:** Changes span DB schema (new `displayTitle` column on `runs`), API enrichment (runs endpoint gains payment summary + display titles), three page rewrites (dashboard, run detail, player profile), one new page (global audit log), and nav update. Each task is independently shippable.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui, better-sqlite3, SQLite

---

## Todo → Task Mapping

| Todo item | Task |
|---|---|
| Don't show upcoming runs in outstanding | Task 1 (DB query filter) |
| Outstanding list collapsible, closed by default | Task 4 |
| Upcoming: next event prominent, rest compact | Task 4 |
| Whole run card clickable | Task 4 |
| Replace Manage button with x/n paid | Task 2 + Task 4 |
| Past runs: sort by date, paginate 5 | Task 4 |
| Past runs compact tile display | Task 4 |
| Change copy reminder template text | Task 6 |
| Player names clickable everywhere | Task 5 |
| Global audit log page | Task 3 + Task 7 |
| Payment history on both tabs | Task 5 |
| Per-event payment reminder copy button | Task 5 |
| Custom event name (displayTitle) | Task 1 + Task 2 + Task 5 |
| New Run button → navigate to latest; ··· for create manual | Task 4 |

---

## Task 1: DB Schema + Queries

**Files:**
- Modify: `src/lib/db.ts`

- [ ] **Step 1: Add `displayTitle` migration**

In `src/lib/db.ts`, add to the migration array (after the existing `ALTER TABLE players ADD COLUMN is_anon_plus_one INTEGER DEFAULT 0` line):

```typescript
`ALTER TABLE runs ADD COLUMN displayTitle TEXT`,
```

The full migration array in the file becomes:
```typescript
for (const sql of [
  `ALTER TABLE runs ADD COLUMN totalCost REAL`,
  `ALTER TABLE runs ADD COLUMN splitCount INTEGER DEFAULT 12`,
  `ALTER TABLE runs ADD COLUMN notes TEXT`,
  `ALTER TABLE players ADD COLUMN displayName TEXT`,
  `ALTER TABLE players ADD COLUMN notes TEXT`,
  `ALTER TABLE payments ADD COLUMN amountPaid REAL`,
  `ALTER TABLE runs ADD COLUMN hostUserId TEXT`,
  `ALTER TABLE attendance ADD COLUMN plus_one_of TEXT`,
  `ALTER TABLE players ADD COLUMN is_anon_plus_one INTEGER DEFAULT 0`,
  `ALTER TABLE runs ADD COLUMN displayTitle TEXT`,  // NEW
]) {
```

- [ ] **Step 2: Add `updateRunDisplayTitle` query**

In the `queries` object in `src/lib/db.ts`, add after `updateRunHost`:

```typescript
updateRunDisplayTitle: db.prepare(`
  UPDATE runs SET displayTitle = @displayTitle WHERE eventId = @eventId
`),
```

- [ ] **Step 3: Add `getRunDisplayTitles` and `getPaymentSummaries` queries**

Add after `updateRunDisplayTitle`:

```typescript
getRunDisplayTitles: db.prepare(`
  SELECT eventId, displayTitle FROM runs
`),

getPaymentSummaries: db.prepare(`
  SELECT
    eventId,
    COUNT(CASE WHEN amountPaid IS NOT NULL THEN 1 END) as paidCount,
    COUNT(*) as totalCount
  FROM payments
  GROUP BY eventId
`),
```

- [ ] **Step 4: Add `getGlobalPaymentAuditLog` query**

Add after `getPaymentAuditLog`:

```typescript
getGlobalPaymentAuditLog: db.prepare(`
  SELECT
    l.id, l.eventId, l.userId, l.action, l.amount, l.amountPaid, l.changedAt,
    COALESCE(p.displayName, p.name) AS playerName,
    COALESCE(r.displayTitle, r.title) AS eventTitle
  FROM payment_audit_log l
  LEFT JOIN players p ON p.userId = l.userId
  LEFT JOIN runs r ON r.eventId = l.eventId
  ORDER BY l.changedAt DESC
  LIMIT 500
`),
```

- [ ] **Step 5: Add `GlobalPaymentAuditLogRow` export type**

After the `PaymentAuditLogRow` interface, add:

```typescript
export interface GlobalPaymentAuditLogRow extends PaymentAuditLogRow {
  eventTitle: string;
}
```

- [ ] **Step 6: Modify `getPlayerStats` to exclude future runs from balance**

Find the `getPlayerStats` prepared query. Replace the `balance` SUM expression:

Old:
```sql
COALESCE(SUM(
  COALESCE(pay.amountPaid, 0) -
  COALESCE(pay.amount, CASE WHEN r.totalCost IS NOT NULL THEN r.totalCost / COALESCE(r.splitCount, 12) ELSE 0 END)
), 0) as balance
```

New (wrap in a CASE that excludes future startDates):
```sql
COALESCE(SUM(
  CASE WHEN r.startDate IS NULL OR r.startDate <= datetime('now') THEN
    COALESCE(pay.amountPaid, 0) -
    COALESCE(pay.amount, CASE WHEN r.totalCost IS NOT NULL THEN r.totalCost / COALESCE(r.splitCount, 12) ELSE 0 END)
  ELSE 0 END
), 0) as balance
```

- [ ] **Step 7: Build to verify types compile**

```bash
cd /Users/kevingeng/code/vball-tracker && npm run build 2>&1 | tail -20
```

Expected: Build succeeds (or only pre-existing errors unrelated to db.ts).

- [ ] **Step 8: Commit**

```bash
cd /Users/kevingeng/code/vball-tracker && git add src/lib/db.ts && git commit -m "feat: add displayTitle to runs, global audit log query, exclude future runs from outstanding balance"
```

---

## Task 2: Runs API Enrichment (displayTitle + payment summary)

**Files:**
- Modify: `src/app/api/runs/route.ts`
- Modify: `src/app/api/runs/[id]/route.ts`

- [ ] **Step 1: Update `/api/runs` GET to include displayTitle and payment stats**

Replace the full content of `src/app/api/runs/route.ts`:

```typescript
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getUpcomingEvents, getPastEvents } from "@keg/partiful-api";
import { queries } from "@/lib/db";

const VBALL_RE = /vball|volley|🏐/i;

function isVballEvent(event: { title?: string }) {
  return VBALL_RE.test(event.title ?? "");
}

interface PartifulEventRaw {
  id: string;
  title: string;
  startDate: string | null;
  status: string;
}

interface EnrichedEvent extends PartifulEventRaw {
  displayTitle: string | null;
  paidCount: number;
  totalCount: number;
}

export async function GET() {
  const [upcoming, past] = await Promise.all([
    getUpcomingEvents(),
    getPastEvents(),
  ]);

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
  const displayTitleRows = queries.getRunDisplayTitles.all() as {
    eventId: string;
    displayTitle: string | null;
  }[];
  const displayTitleMap = new Map(
    displayTitleRows.map((r) => [r.eventId, r.displayTitle]),
  );

  const paymentSummaryRows = queries.getPaymentSummaries.all() as {
    eventId: string;
    paidCount: number;
    totalCount: number;
  }[];
  const paymentMap = new Map(
    paymentSummaryRows.map((s) => [s.eventId, s]),
  );

  const enrich = (event: PartifulEventRaw): EnrichedEvent => ({
    ...event,
    displayTitle: displayTitleMap.get(event.id) ?? null,
    paidCount: paymentMap.get(event.id)?.paidCount ?? 0,
    totalCount: paymentMap.get(event.id)?.totalCount ?? 0,
  });

  return NextResponse.json({
    upcoming: [
      ...(upcoming.result.data.upcomingEvents ?? [])
        .filter(isVballEvent)
        .map(enrich),
      ...upcomingManual.map(enrich),
    ],
    past: [
      ...(past.result.data.pastEvents ?? [])
        .filter(isVballEvent)
        .map(enrich),
      ...pastManual.map(enrich),
    ],
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
    startDate: startDate ?? null,
    status: "manual",
    paidCount: 0,
    totalCount: 0,
  });
}
```

- [ ] **Step 2: Update `/api/runs/[id]` GET to include displayTitle**

In `src/app/api/runs/[id]/route.ts`, update the `run` object construction in the GET handler. Find:

```typescript
const run = {
  eventId: r0.eventId,
  title: r0.title,
  startDate: r0.startDate,
```

Replace with:

```typescript
const run = {
  eventId: r0.eventId,
  title: r0.title,
  displayTitle: (r0.displayTitle as string | null) ?? null,
  startDate: r0.startDate,
```

- [ ] **Step 3: Update `/api/runs/[id]` PATCH to handle displayTitle**

In `src/app/api/runs/[id]/route.ts`, in the PATCH handler, add after the `if (body.title) { ... }` block:

```typescript
if ("displayTitle" in body) {
  queries.updateRunDisplayTitle.run({
    eventId: params.id,
    displayTitle: body.displayTitle ?? null,
  });
}
```

- [ ] **Step 4: Build to verify**

```bash
cd /Users/kevingeng/code/vball-tracker && npm run build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
cd /Users/kevingeng/code/vball-tracker && git add src/app/api/runs/route.ts src/app/api/runs/[id]/route.ts && git commit -m "feat: enrich runs API with displayTitle and payment summary per event"
```

---

## Task 3: Global Audit Log API

**Files:**
- Create: `src/app/api/audit-log/route.ts`

- [ ] **Step 1: Create the global audit log API route**

Create `src/app/api/audit-log/route.ts`:

```typescript
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { queries, GlobalPaymentAuditLogRow } from "@/lib/db";

export async function GET(): Promise<NextResponse> {
  const rows = queries.getGlobalPaymentAuditLog.all() as GlobalPaymentAuditLogRow[];
  return NextResponse.json(rows);
}
```

- [ ] **Step 2: Build to verify**

```bash
cd /Users/kevingeng/code/vball-tracker && npm run build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/kevingeng/code/vball-tracker && git add src/app/api/audit-log/route.ts && git commit -m "feat: add global payment audit log API endpoint"
```

---

## Task 4: Dashboard Page Overhaul

**Files:**
- Modify: `src/app/page.tsx`

This is a full rewrite of `page.tsx`. Replace the entire file content:

- [ ] **Step 1: Write the new dashboard page**

Replace the full content of `src/app/page.tsx` with:

```typescript
"use client";

import { useEffect, useState } from "react";
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
          <div className="relative flex items-center gap-1">
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
              <CardTitle className="text-base truncate">{displayTitle}</CardTitle>
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
```

- [ ] **Step 2: Build to verify types compile**

```bash
cd /Users/kevingeng/code/vball-tracker && npm run build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/kevingeng/code/vball-tracker && git add src/app/page.tsx && git commit -m "feat: dashboard overhaul — collapsible outstanding, hierarchical upcoming cards, compact past tiles, pagination, new-run nav button"
```

---

## Task 5: Run Detail Page Improvements

**Files:**
- Modify: `src/app/runs/[id]/page.tsx`

Changes needed:
1. Add `displayTitle: string | null` to `Run` interface
2. Add `editingTitle`, `titleVal`, `reminderCopied` state
3. Add `updateDisplayTitle` and `copyEventReminder` functions
4. Modify header: click-to-edit title (sets displayTitle), "Copy reminder" button when cost is set
5. Player names in `GuestRow`, `NonGoingGuestRow`, `PaymentRow` → `Link` to `/players/[userId]`
6. Player names in `PaymentHistorySection` → `Link` to `/players/[userId]`
7. Move `PaymentHistorySection` outside both tab conditionals so it shows on both tabs

- [ ] **Step 1: Add `Link` import and update `Run` interface**

First, add `import Link from "next/link";` to the imports at the top of `src/app/runs/[id]/page.tsx`. The current imports are:
```typescript
import { Fragment, useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PaymentAuditAction } from "@/lib/db";
```

Add after the last import:
```typescript
import Link from "next/link";
```

Then, find:
```typescript
interface Run {
  eventId: string;
  title: string;
  startDate: string | null;
```

Replace with:
```typescript
interface Run {
  eventId: string;
  title: string;
  displayTitle: string | null;
  startDate: string | null;
```

- [ ] **Step 2: Add new state variables**

Find in the `RunPage` component:
```typescript
  const [auditLogOpen, setAuditLogOpen] = useState(false);
```

Replace with:
```typescript
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState("");
  const [reminderCopied, setReminderCopied] = useState(false);
```

- [ ] **Step 3: Add `updateDisplayTitle` and `copyEventReminder` functions**

Add after the `updateHost` function (before `savePreset`):

```typescript
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
```

- [ ] **Step 4: Replace the run header title display**

Find the header `<h1>` in RunPage:
```typescript
					<h1 className="text-2xl font-bold">{run.title}</h1>
```

Replace with:
```typescript
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
```

- [ ] **Step 5: Add "Copy reminder" button to header actions**

Find the header buttons section:
```typescript
					<div className="flex gap-2 self-start">
						<a
							href={`https://partiful.com/events/${run.eventId}`}
```

Replace with:
```typescript
					<div className="flex gap-2 self-start flex-wrap justify-end">
						{run.costPerHead != null && (
							<Button
								onClick={copyEventReminder}
								variant="outline"
								size="sm"
							>
								{reminderCopied ? "Copied!" : "Copy reminder"}
							</Button>
						)}
						<a
							href={`https://partiful.com/events/${run.eventId}`}
```

- [ ] **Step 6: Make player names clickable in `GuestRow`**

Find in `GuestRow` function:
```typescript
			<div className="flex items-center gap-2.5">
				<span className="font-medium">{guest.name}</span>
```

Replace with:
```typescript
			<div className="flex items-center gap-2.5">
				<Link
					href={`/players/${guest.userId}`}
					className="font-medium hover:underline"
					onClick={(e) => e.stopPropagation()}
				>
					{guest.name}
				</Link>
```

Also add `import Link from "next/link";` at the top of the file (it's not currently imported). Check if it's already there first — if not, add it after the last import.

- [ ] **Step 7: Make player names clickable in `NonGoingGuestRow`**

Find in `NonGoingGuestRow` function:
```typescript
		<span className="font-medium">{guest.name}</span>
		<RsvpBadge status={guest.rsvpStatus} />
```

Replace with:
```typescript
		<Link
			href={`/players/${guest.userId}`}
			className="font-medium hover:underline"
		>
			{guest.name}
		</Link>
		<RsvpBadge status={guest.rsvpStatus} />
```

- [ ] **Step 8: Make player names clickable in `PaymentRow`**

Find in `PaymentRow` function:
```typescript
				<span className="font-medium">{guest.name}</span>
```

(There's only one instance — the main name display in the non-editing state)

Replace with:
```typescript
				<Link
					href={`/players/${guest.userId}`}
					className="font-medium hover:underline"
				>
					{guest.name}
				</Link>
```

- [ ] **Step 9: Make player names clickable in `PaymentHistorySection`**

Find in `PaymentHistorySection` function:
```typescript
								<span className="font-medium">{e.playerName}</span>
```

Replace with:
```typescript
								<Link
									href={`/players/${e.userId}`}
									className="font-medium hover:underline"
								>
									{e.playerName}
								</Link>
```

- [ ] **Step 10: Move PaymentHistorySection to show on both tabs**

Currently `<PaymentHistorySection ... />` is rendered inside `{activeTab === "payments" && ...}`. Move it out to render after both tab conditionals, before the `{run.syncedAt && ...}` line.

Find:
```typescript
				{activeTab === "payments" && (
					<div className="space-y-3">
						...
						<PaymentHistorySection
							entries={auditLog}
							loaded={auditLogLoaded}
							open={auditLogOpen}
							onToggle={() => {
								if (!auditLogOpen) loadAuditLog();
								setAuditLogOpen((v) => !v);
							}}
						/>
					</div>
				)}
			</div>

			{run.syncedAt && (
```

The `PaymentHistorySection` block should be removed from inside `activeTab === "payments"` and placed after the closing `</div>` of the tab container. The exact change:

Remove `<PaymentHistorySection ... />` from the payments tab block.

Add it after the closing `</div>` that closes the `<div className="space-y-4">` tab container (the one that wraps the tab nav and both tab content blocks):

```typescript
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
```

- [ ] **Step 11: Build to verify**

```bash
cd /Users/kevingeng/code/vball-tracker && npm run build 2>&1 | tail -30
```

Expected: Build succeeds.

- [ ] **Step 12: Commit**

```bash
cd /Users/kevingeng/code/vball-tracker && git add src/app/runs/[id]/page.tsx && git commit -m "feat: run detail — clickable player names, payment history on both tabs, event reminder copy, custom display title"
```

---

## Task 6: Player Profile — Reminder Template Fix

**Files:**
- Modify: `src/app/players/[id]/page.tsx`

- [ ] **Step 1: Update the reminder message and remove unused variable**

In `copyReminder` in `src/app/players/[id]/page.tsx`, find the `name` declaration and old message together:

```typescript
		const name = player.displayName ?? player.name;
		const msg = `Hey ${name}, you owe $${owed} from ${runCount} run${runCount !== 1 ? "s" : ""}. Venmo/e-transfer whenever!`;
```

Replace with (the new template doesn't reference `name`, so remove the variable too):

```typescript
		const msg = `Hey, you owe $${owed} from ${runCount} run${runCount !== 1 ? "s" : ""}. Please etransfer me at kevingeng33@gmail.com when you get the chance!`;
```

- [ ] **Step 2: Build to verify**

```bash
cd /Users/kevingeng/code/vball-tracker && npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd /Users/kevingeng/code/vball-tracker && git add src/app/players/[id]/page.tsx && git commit -m "fix: update payment reminder template to etransfer wording"
```

---

## Task 7: Global Audit Log Page + Nav Link

**Files:**
- Create: `src/app/audit-log/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create global audit log page**

Create `src/app/audit-log/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { GlobalPaymentAuditLogRow } from "@/lib/db";

export default function AuditLogPage() {
  const [entries, setEntries] = useState<GlobalPaymentAuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/audit-log")
      .then((r) => r.json())
      .then(setEntries)
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
```

- [ ] **Step 2: Add Audit Log link to nav**

In `src/app/layout.tsx`, find the Players nav link:

```typescript
					<Link
						href="/players"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Players
					</Link>
```

Add after it:

```typescript
					<Link
						href="/audit-log"
						className="text-sm text-muted-foreground hover:text-foreground"
					>
						Audit Log
					</Link>
```

- [ ] **Step 3: Build to verify**

```bash
cd /Users/kevingeng/code/vball-tracker && npm run build 2>&1 | tail -20
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/kevingeng/code/vball-tracker && git add src/app/audit-log/page.tsx src/app/layout.tsx && git commit -m "feat: add global payment audit log page and nav link"
```

---

## Self-Review

### Spec coverage check

| Todo item | Covered by |
|---|---|
| Don't show upcoming in outstanding balance | Task 1 Step 6 — `getPlayerStats` CASE filter |
| Outstanding list collapsible, closed by default | Task 4 — `outstandingOpen` state, starts `false` |
| Upcoming: next event prominent | Task 4 — `PrimaryUpcomingCard` for `sortedUpcoming[0]` |
| Upcoming: rest smaller with date as main | Task 4 — `CompactUpcomingTile` (date is left/primary) |
| Clicking run card anywhere opens run | Task 4 — entire card wrapped in `<Link>` |
| Replace Manage button with x/n paid | Task 4 — no Manage button; `paidCount/totalCount` in card |
| Past runs sort by date | Task 4 — `sortedPast` sorted DESC by startDate |
| Past runs paginate 5 at a time | Task 4 — `pastPagesShown * PAST_PAGE_SIZE` + Load more |
| Past runs compact tile | Task 4 — `PastRunTile` component |
| Change copy reminder template | Task 6 — exact new wording |
| Player names clickable everywhere | Task 5 — GuestRow, NonGoingGuestRow, PaymentRow, PaymentHistorySection |
| Global audit log page | Task 3 (API) + Task 7 (page + nav) |
| Payment history on both tabs | Task 5 Step 10 — moved outside tab conditionals |
| Per-event reminder template | Task 5 Steps 3+5 — `copyEventReminder`, shows when `costPerHead != null` |
| Custom event name | Task 1 (column), Task 2 (API), Task 5 Steps 1+4 (UI edit) |
| New Run button → navigate to latest | Task 4 — `latestRun` logic, `router.push` on click |
| ··· menu for create manual run | Task 4 — `showDotMenu` dropdown with "Create manual run" |

### Potential issues

1. **`GlobalPaymentAuditLogRow` used in client component** — Client pages can't import server-only types directly from `@/lib/db` because `better-sqlite3` is server-only. The `audit-log/page.tsx` imports `GlobalPaymentAuditLogRow` only as a TypeScript type (`import type`), so it's stripped at compile time and won't cause runtime errors.

2. **`Link` import in runs/[id]/page.tsx** — Task 5 Step 1 adds this import before any steps that use `Link` (Steps 6–9).

3. **`displayTitle` in `Run` interface (runs/[id]/page.tsx)** — Task 5 Step 1 adds it to the interface. The API returns it (Task 2 Step 2), so it will be populated at runtime.

4. **PaymentHistorySection userId field** — The `AuditLogEntry` interface already has `userId` (used in Task 5 Step 9). No change needed to the interface.
