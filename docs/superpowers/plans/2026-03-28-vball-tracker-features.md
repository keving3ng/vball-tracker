# VBall Tracker Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cost management, per-player balance tracking, a calendar view, player profile pages, and quality-of-life features to VBall Tracker.

**Architecture:** Schema migrations run at startup via try/catch ALTER TABLE. All cost data flows through `totalCost`/`splitCount` on runs; `costPerHead` is computed from these. Player balances are computed live from the payments table as `SUM(COALESCE(amountPaid, 0) - amount)`. New pages (`/calendar`, `/players/[id]`) are added as Next.js App Router client components.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3, Tailwind CSS, shadcn/ui

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/db.ts` | Modify | Schema migrations, all queries, interfaces |
| `src/app/layout.tsx` | Modify | Add Calendar nav link |
| `src/app/page.tsx` | Modify | Dashboard balance summary |
| `src/app/calendar/page.tsx` | Create | Month grid calendar view |
| `src/app/players/page.tsx` | Modify | Balance column, clickable rows, displayName |
| `src/app/players/[id]/page.tsx` | Create | Player profile: name, balance, run history, streaks |
| `src/app/runs/[id]/page.tsx` | Modify | Cost inputs, notes, custom payment amounts, waitlist, quick-add |
| `src/app/api/players/route.ts` | No change | getPlayerStats already updated in Task 2 |
| `src/app/api/players/[id]/route.ts` | Create | GET player profile + PATCH displayName/notes |
| `src/app/api/runs/[id]/route.ts` | Modify | Computed costPerHead, notes, totalCost/splitCount, amountPaid |
| `src/app/api/runs/[id]/sync/route.ts` | Modify | Default cost from last run, GOING-only payment records |
| `src/app/api/runs/[id]/payments/route.ts` | Modify | Store amountPaid, handle custom amounts |
| `src/app/api/runs/[id]/guests/route.ts` | Create | Manual guest quick-add |
| `src/app/api/settings/route.ts` | Create | GET/POST cost presets |

---

## Task 1: Commit pending cleanups

The working tree has uncommitted changes removing the attendance-tracking feature (attended flag, attendance route deleted, queries removed). Commit these before adding new features.

- [ ] **Step 1: Stage and commit the cleanup**

```bash
git add src/lib/db.ts src/app/api/runs/[id]/route.ts \
  src/app/players/page.tsx src/app/runs/[id]/page.tsx \
  src/lib/test-partiful.ts
git add -u src/app/api/runs/[id]/attendance/route.ts
git commit -m "refactor: remove attendance tracking, unify paid/going model"
```

---

## Task 2: Schema migrations and updated queries in db.ts

Add new columns via ALTER TABLE, create `settings` table, update all interfaces and queries.

**Files:** Modify `src/lib/db.ts`

- [ ] **Step 1: Replace `src/lib/db.ts` with the full updated version**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR ?? '.';
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'vball.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    userId      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    eventId     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    startDate   TEXT,
    capacity    INTEGER,
    costPerHead REAL,
    syncedAt    TEXT
  );

  CREATE TABLE IF NOT EXISTS attendance (
    eventId    TEXT NOT NULL REFERENCES runs(eventId),
    userId     TEXT NOT NULL REFERENCES players(userId),
    rsvpStatus TEXT NOT NULL DEFAULT 'GOING',
    PRIMARY KEY (eventId, userId)
  );

  CREATE TABLE IF NOT EXISTS payments (
    eventId  TEXT NOT NULL REFERENCES runs(eventId),
    userId   TEXT NOT NULL REFERENCES players(userId),
    amount   REAL NOT NULL DEFAULT 0,
    paid     INTEGER NOT NULL DEFAULT 0,
    method   TEXT,
    note     TEXT,
    PRIMARY KEY (eventId, userId)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Additive schema migrations — safe to run on every startup
for (const sql of [
  `ALTER TABLE runs ADD COLUMN totalCost REAL`,
  `ALTER TABLE runs ADD COLUMN splitCount INTEGER DEFAULT 12`,
  `ALTER TABLE runs ADD COLUMN notes TEXT`,
  `ALTER TABLE players ADD COLUMN displayName TEXT`,
  `ALTER TABLE players ADD COLUMN notes TEXT`,
  `ALTER TABLE payments ADD COLUMN amountPaid REAL`,
]) {
  try { db.exec(sql); } catch {}
}

export interface Player {
  userId: string; name: string; displayName: string | null; notes: string | null;
}
export interface Run {
  eventId: string; title: string; startDate: string | null;
  capacity: number | null; totalCost: number | null; splitCount: number;
  costPerHead: number | null; notes: string | null; syncedAt: string | null;
}
export interface AttendanceRow { eventId: string; userId: string; rsvpStatus: string }
export interface PaymentRow {
  eventId: string; userId: string; amount: number; amountPaid: number | null;
  paid: boolean; method: string | null; note: string | null;
}

export const queries = {
  upsertPlayer: db.prepare(`
    INSERT INTO players (userId, name, updatedAt)
    VALUES (@userId, @name, datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET name=excluded.name, updatedAt=excluded.updatedAt
  `),

  upsertRun: db.prepare(`
    INSERT INTO runs (eventId, title, startDate, syncedAt)
    VALUES (@eventId, @title, @startDate, datetime('now'))
    ON CONFLICT(eventId) DO UPDATE SET
      title=excluded.title, startDate=excluded.startDate, syncedAt=excluded.syncedAt
  `),

  getRunBasic: db.prepare(`SELECT * FROM runs WHERE eventId = ?`),

  updateRunCost: db.prepare(`
    UPDATE runs SET totalCost=@totalCost, splitCount=@splitCount WHERE eventId=@eventId
  `),

  updateRunNotes: db.prepare(`
    UPDATE runs SET notes=@notes WHERE eventId=@eventId
  `),

  getLastRunCost: db.prepare(`
    SELECT totalCost, splitCount FROM runs
    WHERE totalCost IS NOT NULL ORDER BY startDate DESC LIMIT 1
  `),

  upsertAttendance: db.prepare(`
    INSERT INTO attendance (eventId, userId, rsvpStatus)
    VALUES (@eventId, @userId, @rsvpStatus)
    ON CONFLICT(eventId, userId) DO UPDATE SET rsvpStatus=excluded.rsvpStatus
  `),

  // Full payment upsert — call when recording or clearing a payment
  upsertPayment: db.prepare(`
    INSERT INTO payments (eventId, userId, amount, amountPaid, paid, method, note)
    VALUES (@eventId, @userId, @amount, @amountPaid, @paid, @method, @note)
    ON CONFLICT(eventId, userId) DO UPDATE SET
      amount=excluded.amount, amountPaid=excluded.amountPaid, paid=excluded.paid,
      method=excluded.method, note=excluded.note
  `),

  // Lightweight upsert — only sets amount owed, never clears amountPaid
  upsertPaymentOwed: db.prepare(`
    INSERT INTO payments (eventId, userId, amount, paid)
    VALUES (@eventId, @userId, @amount, 0)
    ON CONFLICT(eventId, userId) DO UPDATE SET amount=excluded.amount
  `),

  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  upsertSetting: db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `),

  getRunWithGuests: db.prepare(`
    SELECT
      r.*,
      a.userId, a.rsvpStatus,
      p.name, p.displayName,
      pay.amount, pay.amountPaid, pay.method, pay.note
    FROM runs r
    LEFT JOIN attendance a ON a.eventId = r.eventId
    LEFT JOIN players p ON p.userId = a.userId
    LEFT JOIN payments pay ON pay.eventId = r.eventId AND pay.userId = a.userId
    WHERE r.eventId = ?
    ORDER BY a.rsvpStatus, COALESCE(p.displayName, p.name)
  `),

  getPlayerStats: db.prepare(`
    SELECT
      p.userId,
      p.name,
      p.displayName,
      COUNT(DISTINCT a.eventId) as totalRuns,
      COALESCE(SUM(CASE WHEN pay.amountPaid IS NOT NULL THEN 1 ELSE 0 END), 0) as paidRuns,
      COALESCE(SUM(CASE WHEN pay.amountPaid IS NULL AND pay.amount > 0 THEN 1 ELSE 0 END), 0) as owingRuns,
      COALESCE(SUM(COALESCE(pay.amountPaid, 0) - pay.amount), 0) as balance
    FROM players p
    LEFT JOIN attendance a ON a.userId = p.userId AND a.rsvpStatus = 'GOING'
    LEFT JOIN payments pay ON pay.userId = p.userId AND pay.eventId = a.eventId
    GROUP BY p.userId
    ORDER BY totalRuns DESC
  `),

  getPlayerProfile: db.prepare(`
    SELECT
      p.userId, p.name, p.displayName, p.notes,
      r.eventId, r.title, r.startDate, r.totalCost, r.splitCount,
      pay.amount, pay.amountPaid, pay.method, pay.note
    FROM players p
    LEFT JOIN attendance a ON a.userId = p.userId AND a.rsvpStatus = 'GOING'
    LEFT JOIN runs r ON r.eventId = a.eventId
    LEFT JOIN payments pay ON pay.userId = p.userId AND pay.eventId = a.eventId
    WHERE p.userId = ?
    ORDER BY r.startDate DESC
  `),

  getPlayerAttendanceHistory: db.prepare(`
    SELECT r.eventId, r.startDate,
      CASE WHEN a.userId IS NOT NULL THEN 1 ELSE 0 END as attended
    FROM runs r
    LEFT JOIN attendance a
      ON a.eventId = r.eventId AND a.userId = ? AND a.rsvpStatus = 'GOING'
    WHERE r.startDate IS NOT NULL
    ORDER BY r.startDate DESC
  `),

  updatePlayerProfile: db.prepare(`
    UPDATE players SET displayName=@displayName, notes=@notes, updatedAt=datetime('now')
    WHERE userId=@userId
  `),
};

export default db;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors (or only pre-existing unrelated errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: schema migrations — totalCost, splitCount, notes, displayName, amountPaid, settings"
```

---

## Task 3: Update run API routes (GET/PATCH)

Compute `costPerHead` from `totalCost/splitCount`, expose `notes`, handle new PATCH fields.

**Files:** Modify `src/app/api/runs/[id]/route.ts`

- [ ] **Step 1: Replace `src/app/api/runs/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rows = queries.getRunWithGuests.all(params.id) as any[];
  if (!rows.length) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const r0 = rows[0];
  const splitCount = r0.splitCount ?? 12;
  const costPerHead = r0.totalCost != null
    ? r0.totalCost / splitCount
    : (r0.costPerHead ?? null);

  const run = {
    eventId: r0.eventId,
    title: r0.title,
    startDate: r0.startDate,
    capacity: r0.capacity,
    totalCost: r0.totalCost,
    splitCount,
    costPerHead,
    notes: r0.notes,
    syncedAt: r0.syncedAt,
    guests: rows
      .filter(r => r.userId)
      .map(r => ({
        userId: r.userId,
        name: r.displayName ?? r.name,
        partifulName: r.name,
        rsvpStatus: r.rsvpStatus,
        payment: {
          amount: r.amount,
          amountPaid: r.amountPaid,
          // backwards-compat: treat paid=1 rows with no amountPaid as fully paid
          paid: r.amountPaid != null || Boolean(r.paid),
          method: r.method,
          note: r.note,
        },
      })),
  };

  return NextResponse.json(run);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();

  if (body.title) {
    queries.upsertRun.run({
      eventId: params.id,
      title: body.title,
      startDate: body.startDate ?? null,
    });
  }
  if (body.totalCost !== undefined || body.splitCount !== undefined) {
    queries.updateRunCost.run({
      eventId: params.id,
      totalCost: body.totalCost ?? null,
      splitCount: body.splitCount ?? 12,
    });
  }
  if (body.notes !== undefined) {
    queries.updateRunNotes.run({ eventId: params.id, notes: body.notes });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/runs/[id]/route.ts
git commit -m "feat: run API returns computed costPerHead, totalCost, splitCount, notes"
```

---

## Task 4: Update payments route to support amountPaid

**Files:** Modify `src/app/api/runs/[id]/payments/route.ts`

- [ ] **Step 1: Replace the payments route**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { userId, amount, amountPaid, method, note } = body;

  // amountPaid: null = mark unpaid, number = paid that amount
  const resolvedAmountPaid: number | null = amountPaid !== undefined ? amountPaid : null;

  queries.upsertPayment.run({
    eventId: params.id,
    userId,
    amount: amount ?? 0,
    amountPaid: resolvedAmountPaid,
    paid: resolvedAmountPaid != null ? 1 : 0,
    method: method ?? null,
    note: note ?? null,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/runs/[id]/payments/route.ts
git commit -m "feat: payments route stores amountPaid for custom payment amounts"
```

---

## Task 5: Update sync route — GOING-only payments, default cost from last run

**Files:** Modify `src/app/api/runs/[id]/sync/route.ts`

- [ ] **Step 1: Replace the sync route**

```typescript
import { NextResponse } from 'next/server';
import { getEventGuests } from 'partiful-api';
import { queries } from '@/lib/db';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guests = await getEventGuests(params.id);

  // Default totalCost/splitCount from last run if this run has none
  const run = queries.getRunBasic.get(params.id) as any;
  let totalCost: number | null = run?.totalCost ?? null;
  let splitCount: number = run?.splitCount ?? 12;

  if (totalCost == null) {
    const last = queries.getLastRunCost.get() as any;
    if (last?.totalCost != null) {
      totalCost = last.totalCost;
      splitCount = last.splitCount ?? 12;
      queries.updateRunCost.run({ eventId: params.id, totalCost, splitCount });
    }
  }

  const amountOwed = totalCost != null ? totalCost / splitCount : 0;

  for (const guest of guests) {
    queries.upsertPlayer.run({ userId: guest.userId, name: guest.name });
    queries.upsertAttendance.run({
      eventId: params.id,
      userId: guest.userId,
      rsvpStatus: guest.status,
    });

    // Only create payment records for GOING guests
    if (guest.status === 'GOING' && amountOwed > 0) {
      queries.upsertPaymentOwed.run({
        eventId: params.id,
        userId: guest.userId,
        amount: amountOwed,
      });
    }
  }

  return NextResponse.json({ synced: guests.length });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/runs/[id]/sync/route.ts
git commit -m "feat: sync creates GOING-only payment records, defaults cost from last run"
```

---

## Task 6: Settings API for cost presets

**Files:** Create `src/app/api/settings/route.ts`

- [ ] **Step 1: Create the settings route**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key') ?? 'costPresets';
  const row = queries.getSetting.get(key) as any;
  return NextResponse.json(row ? JSON.parse(row.value) : []);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { key = 'costPresets', value } = body;
  queries.upsertSetting.run({ key, value: JSON.stringify(value) });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/settings/route.ts
git commit -m "feat: settings API for cost presets"
```

---

## Task 7: Guest quick-add API

**Files:** Create `src/app/api/runs/[id]/guests/route.ts`

- [ ] **Step 1: Create the guests route**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { name } = await req.json();
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name required' }, { status: 400 });
  }

  const userId = `manual-${Date.now()}`;
  queries.upsertPlayer.run({ userId, name: name.trim() });
  queries.upsertAttendance.run({ eventId: params.id, userId, rsvpStatus: 'GOING' });

  const run = queries.getRunBasic.get(params.id) as any;
  if (run?.totalCost != null) {
    const amount = run.totalCost / (run.splitCount ?? 12);
    queries.upsertPaymentOwed.run({ eventId: params.id, userId, amount });
  }

  return NextResponse.json({ ok: true, userId });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/runs/[id]/guests/route.ts
git commit -m "feat: manual guest quick-add API"
```

---

## Task 8: Player profile API

**Files:** Create `src/app/api/players/[id]/route.ts`

- [ ] **Step 1: Create `src/app/api/players/[id]/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rows = queries.getPlayerProfile.all(params.id) as any[];
  if (!rows.length) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  const p = rows[0];

  const runs = rows
    .filter(r => r.eventId)
    .map(r => {
      const splitCount = r.splitCount ?? 12;
      const amountOwed = r.amount ?? (r.totalCost != null ? r.totalCost / splitCount : 0);
      const amountPaid: number | null = r.amountPaid ?? (r.paid ? amountOwed : null);
      return {
        eventId: r.eventId,
        title: r.title,
        startDate: r.startDate,
        amountOwed,
        amountPaid,
        paid: amountPaid != null,
        method: r.method,
        note: r.note,
      };
    });

  const balance = runs.reduce((sum, r) => sum + (r.amountPaid ?? 0) - r.amountOwed, 0);

  // Streak computation from full attendance history (all runs, not just attended)
  const history = queries.getPlayerAttendanceHistory.all(params.id) as any[];
  let currentStreak = 0;
  for (const row of history) {
    if (row.attended) currentStreak++;
    else break;
  }
  let bestStreak = 0;
  let temp = 0;
  for (const row of history) {
    if (row.attended) { temp++; bestStreak = Math.max(bestStreak, temp); }
    else temp = 0;
  }

  return NextResponse.json({
    userId: p.userId,
    name: p.name,
    displayName: p.displayName,
    notes: p.notes,
    balance,
    currentStreak,
    bestStreak,
    runs,
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const existing = queries.getPlayerProfile.all(params.id)[0] as any;
  if (!existing) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  queries.updatePlayerProfile.run({
    userId: params.id,
    displayName: body.displayName !== undefined ? body.displayName : existing.displayName,
    notes: body.notes !== undefined ? body.notes : existing.notes,
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/players/[id]/route.ts
git commit -m "feat: player profile API with balance, streaks, run history"
```

---

## Task 9: Update players list page

**Files:** Modify `src/app/players/page.tsx`

- [ ] **Step 1: Replace `src/app/players/page.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface PlayerStats {
  userId: string;
  name: string;
  displayName: string | null;
  totalRuns: number;
  balance: number;
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/players')
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load players: ${r.status}`);
        return r.json();
      })
      .then(setPlayers)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading players...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Players</h1>
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Player</th>
              <th className="text-center px-4 py-2 font-medium">Runs</th>
              <th className="text-center px-4 py-2 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr
                key={p.userId}
                className={`cursor-pointer hover:bg-muted/50 ${i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}`}
              >
                <td className="px-4 py-2">
                  <Link href={`/players/${p.userId}`} className="block font-medium hover:underline">
                    {p.displayName ?? p.name}
                    {p.displayName && (
                      <span className="ml-1 text-xs text-muted-foreground">({p.name})</span>
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
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/players/page.tsx
git commit -m "feat: players list shows balance, displayName, links to profile pages"
```

---

## Task 10: Player profile page

**Files:** Create `src/app/players/[id]/page.tsx`

- [ ] **Step 1: Create `src/app/players/[id]/page.tsx`**

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

export default function PlayerProfilePage({ params }: { params: { id: string } }) {
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesVal, setNotesVal] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/players/${params.id}`);
    if (res.ok) {
      const data = await res.json();
      setPlayer(data);
      setNameVal(data.displayName ?? '');
      setNotesVal(data.notes ?? '');
    }
    setLoading(false);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  const saveName = async () => {
    await fetch(`/api/players/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: nameVal.trim() || null }),
    });
    setPlayer(prev => prev ? { ...prev, displayName: nameVal.trim() || null } : prev);
    setEditingName(false);
  };

  const saveNotes = async () => {
    await fetch(`/api/players/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesVal.trim() || null }),
    });
    setPlayer(prev => prev ? { ...prev, notes: notesVal.trim() || null } : prev);
    setEditingNotes(false);
  };

  const recordPayment = async (eventId: string, amountOwed: number, amountPaid: number | null) => {
    await fetch(`/api/runs/${eventId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: params.id, amount: amountOwed, amountPaid }),
    });
    setPlayer(prev => {
      if (!prev) return prev;
      const updatedRuns = prev.runs.map(r =>
        r.eventId === eventId ? { ...r, amountPaid, paid: amountPaid != null } : r
      );
      const newBalance = updatedRuns.reduce((sum, r) => sum + (r.amountPaid ?? 0) - r.amountOwed, 0);
      return { ...prev, balance: newBalance, runs: updatedRuns };
    });
  };

  const copyReminder = () => {
    if (!player) return;
    const name = player.displayName ?? player.name;
    const owed = Math.abs(player.balance).toFixed(2);
    const runCount = player.runs.filter(r => !r.paid).length;
    const msg = `Hey ${name}, you owe $${owed} from ${runCount} run${runCount !== 1 ? 's' : ''}. Venmo/e-transfer whenever!`;
    navigator.clipboard.writeText(msg);
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!player) return <p className="text-destructive">Player not found</p>;

  const displayName = player.displayName ?? player.name;

  return (
    <div className="space-y-6">
      <Link href="/players" className="text-sm text-muted-foreground hover:text-foreground">
        ← Players
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                className="text-2xl font-bold border-b border-input bg-transparent outline-none"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') setEditingName(false);
                }}
              />
              <Button size="sm" onClick={saveName}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingName(false)}>✕</Button>
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
            <p className="text-sm text-muted-foreground">Partiful: {player.name}</p>
          )}
        </div>

        <div className="text-right space-y-1">
          <div className={`text-2xl font-bold ${
            player.balance < 0 ? 'text-destructive' :
            player.balance > 0 ? 'text-green-600' : 'text-muted-foreground'
          }`}>
            {player.balance < 0
              ? `-$${Math.abs(player.balance).toFixed(2)}`
              : player.balance > 0
              ? `+$${player.balance.toFixed(2)}`
              : '$0.00'}
          </div>
          <p className="text-xs text-muted-foreground">
            {player.balance < 0 ? 'owes' : player.balance > 0 ? 'credit' : 'settled'}
          </p>
          {player.balance < 0 && (
            <Button size="sm" variant="outline" onClick={copyReminder}>
              Copy reminder
            </Button>
          )}
        </div>
      </div>

      {/* Streaks */}
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

      {/* Notes */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Notes</p>
        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              value={notesVal}
              onChange={e => setNotesVal(e.target.value)}
              className="w-full border rounded px-2 py-1 text-sm min-h-[60px]"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveNotes}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingNotes(false)}>Cancel</Button>
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

      {/* Run history */}
      <div className="space-y-2">
        <h2 className="font-semibold">Run History</h2>
        {player.runs.length === 0 && (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        )}
        {player.runs.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Run</th>
                  <th className="text-center px-4 py-2 font-medium">Owed</th>
                  <th className="text-center px-4 py-2 font-medium">Paid</th>
                  <th className="text-center px-4 py-2 font-medium">Status</th>
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
        )}
      </div>
    </div>
  );
}

function RunHistoryRow({
  run, striped, onRecord,
}: {
  run: RunEntry;
  striped: boolean;
  onRecord: (eventId: string, amountOwed: number, amountPaid: number | null) => void;
}) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [customAmount, setCustomAmount] = useState('');

  const date = run.startDate
    ? new Date(run.startDate).toLocaleDateString('en-CA', {
        month: 'short', day: 'numeric', year: 'numeric',
      })
    : '—';

  const status = !run.paid
    ? 'unpaid'
    : run.amountPaid != null && run.amountPaid !== run.amountOwed
    ? 'partial'
    : 'paid';

  return (
    <tr className={striped ? 'bg-muted/30' : 'bg-background'}>
      <td className="px-4 py-2">
        <Link href={`/runs/${run.eventId}`} className="font-medium hover:underline">
          {run.title}
        </Link>
        <p className="text-xs text-muted-foreground">{date}</p>
      </td>
      <td className="px-4 py-2 text-center">${run.amountOwed.toFixed(2)}</td>
      <td className="px-4 py-2 text-center">
        {run.amountPaid != null ? `$${run.amountPaid.toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-2 text-center">
        <Badge
          variant={
            status === 'paid' ? 'default' :
            status === 'partial' ? 'secondary' : 'outline'
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
              onChange={e => setCustomAmount(e.target.value)}
              className="w-16 border rounded px-1 py-0.5 text-xs"
              placeholder={run.amountOwed.toFixed(2)}
              autoFocus
            />
            <Button size="sm" onClick={() => {
              onRecord(run.eventId, run.amountOwed, parseFloat(customAmount) || run.amountOwed);
              setEditingAmount(false);
            }}>✓</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingAmount(false)}>✕</Button>
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
              variant={run.paid ? 'default' : 'outline'}
              onClick={() => onRecord(run.eventId, run.amountOwed, run.paid ? null : run.amountOwed)}
            >
              {run.paid ? '✓ Paid' : 'Mark Paid'}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/app/players/[id]/page.tsx
git commit -m "feat: player profile page with balance, streaks, run history, pay toggle, notes"
```

---

## Task 11: Update run detail page

Replace cost inputs, add notes field, custom payment amounts, waitlist display, and guest quick-add.

**Files:** Modify `src/app/runs/[id]/page.tsx`

- [ ] **Step 1: Replace `src/app/runs/[id]/page.tsx`**

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  payment: Payment;
}

interface Run {
  eventId: string;
  title: string;
  startDate: string | null;
  capacity: number | null;
  totalCost: number | null;
  splitCount: number;
  costPerHead: number | null;
  notes: string | null;
  syncedAt: string | null;
  guests: Guest[];
}

interface Preset { name: string; totalCost: number; splitCount: number }

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [showAddGuest, setShowAddGuest] = useState(false);
  const [newGuestName, setNewGuestName] = useState('');

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const runsData = await fetch('/api/runs').then(r => r.json());
      const all = [...runsData.upcoming, ...runsData.past];
      const event = all.find((e: any) => e.id === params.id);
      if (event) {
        await fetch(`/api/runs/${params.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: event.title, startDate: event.startDate }),
        });
      }
      await fetch(`/api/runs/${params.id}/sync`, { method: 'POST' });
      const res = await fetch(`/api/runs/${params.id}`);
      if (res.ok) setRun(await res.json());
    } finally {
      setSyncing(false);
    }
  }, [params.id]);

  const load = useCallback(async () => {
    const [runRes, presetsRes] = await Promise.all([
      fetch(`/api/runs/${params.id}`),
      fetch('/api/settings?key=costPresets'),
    ]);
    if (runRes.ok) {
      setRun(await runRes.json());
    } else {
      await sync();
    }
    if (presetsRes.ok) setPresets(await presetsRes.json());
    setLoading(false);
  }, [params.id, sync]);

  useEffect(() => { load(); }, [load]);

  const recordPayment = async (userId: string, amountOwed: number, amountPaid: number | null) => {
    await fetch(`/api/runs/${params.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, amount: amountOwed, amountPaid }),
    });
    setRun(prev => prev ? {
      ...prev,
      guests: prev.guests.map(g =>
        g.userId === userId
          ? { ...g, payment: { ...g.payment, amount: amountOwed, amountPaid, paid: amountPaid != null } }
          : g
      ),
    } : prev);
  };

  const updateCost = async (totalCost: number, splitCount: number) => {
    await fetch(`/api/runs/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalCost, splitCount }),
    });
    setRun(prev => prev
      ? { ...prev, totalCost, splitCount, costPerHead: totalCost / splitCount }
      : prev);
  };

  const updateNotes = async (notes: string) => {
    await fetch(`/api/runs/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes }),
    });
    setRun(prev => prev ? { ...prev, notes } : prev);
  };

  const savePreset = async () => {
    if (!run?.totalCost) return;
    const name = window.prompt('Preset name (e.g. "Weekday $90 / 12"):');
    if (!name) return;
    const newPresets = [...presets, { name, totalCost: run.totalCost, splitCount: run.splitCount }];
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'costPresets', value: newPresets }),
    });
    setPresets(newPresets);
  };

  const addGuest = async () => {
    if (!newGuestName.trim()) return;
    await fetch(`/api/runs/${params.id}/guests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGuestName.trim() }),
    });
    setNewGuestName('');
    setShowAddGuest(false);
    const res = await fetch(`/api/runs/${params.id}`);
    if (res.ok) setRun(await res.json());
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!run) return <p className="text-destructive">Run not found</p>;

  const going = run.guests.filter(g => g.rsvpStatus === 'GOING');
  const maybe = run.guests.filter(g => g.rsvpStatus === 'MAYBE');
  const waitlist = run.guests.filter(g => g.rsvpStatus === 'WAITLIST');
  const other = run.guests.filter(g => !['GOING', 'MAYBE', 'WAITLIST'].includes(g.rsvpStatus));
  const paid = going.filter(g => g.payment?.paid);
  const costPerHead = run.costPerHead ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-1 flex-1 mr-4">
          <h1 className="text-2xl font-bold">{run.title}</h1>
          <p className="text-muted-foreground text-sm">
            {run.startDate ? new Date(run.startDate).toLocaleDateString('en-CA', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            }) : 'Date TBD'}
          </p>
          <NotesField value={run.notes} onSave={updateNotes} />
        </div>
        <Button onClick={sync} disabled={syncing} variant="outline" size="sm">
          {syncing ? 'Syncing...' : 'Sync Partiful'}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Going" value={`${going.length}${run.capacity ? ` / ${run.capacity}` : ''}`} />
        <StatCard label="Paid" value={`${paid.length} / ${going.length}`} />
      </div>

      <Tabs defaultValue="guests">
        <TabsList>
          <TabsTrigger value="guests">Guest List</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="guests" className="space-y-2 mt-4">
          {going.map(guest => (
            <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} />
          ))}
          {maybe.map(guest => (
            <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} dim />
          ))}
          {waitlist.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wide">Waitlist</p>
              {waitlist.map(guest => (
                <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} dim />
              ))}
            </div>
          )}
          {other.map(guest => (
            <GuestRow key={guest.userId} guest={guest} costPerHead={costPerHead} onRecord={recordPayment} dim />
          ))}

          <div className="mt-3">
            {showAddGuest ? (
              <div className="flex gap-2">
                <input
                  value={newGuestName}
                  onChange={e => setNewGuestName(e.target.value)}
                  placeholder="Guest name"
                  className="border rounded px-2 py-1 text-sm flex-1"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') addGuest();
                    if (e.key === 'Escape') setShowAddGuest(false);
                  }}
                />
                <Button size="sm" onClick={addGuest}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAddGuest(false)}>✕</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowAddGuest(true)}>
                + Add Guest
              </Button>
            )}
          </div>
        </TabsContent>

        <TabsContent value="payments" className="space-y-3 mt-4">
          <CostSection
            totalCost={run.totalCost}
            splitCount={run.splitCount}
            presets={presets}
            onUpdate={updateCost}
            onSavePreset={savePreset}
            onApplyPreset={p => updateCost(p.totalCost, p.splitCount)}
          />
          {going.map(guest => (
            <PaymentRow
              key={guest.userId}
              guest={guest}
              costPerHead={costPerHead}
              onRecord={recordPayment}
            />
          ))}
        </TabsContent>
      </Tabs>

      {run.syncedAt && (
        <p className="text-xs text-muted-foreground">
          Last synced: {new Date(run.syncedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function GuestRow({
  guest, costPerHead, onRecord, dim,
}: {
  guest: Guest; costPerHead: number;
  onRecord: (userId: string, amountOwed: number, amountPaid: number | null) => void;
  dim?: boolean;
}) {
  const amountOwed = guest.payment?.amount || costPerHead;
  const isPaid = guest.payment?.paid;
  return (
    <div className={`flex items-center justify-between px-4 py-2 rounded-lg border ${dim ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="font-medium">{guest.name}</span>
        <RsvpBadge status={guest.rsvpStatus} />
        {guest.userId.startsWith('manual-') && (
          <span className="text-xs text-muted-foreground bg-muted px-1 rounded">manual</span>
        )}
      </div>
      <Button
        variant={isPaid ? 'default' : 'outline'} size="sm"
        onClick={() => onRecord(guest.userId, amountOwed, isPaid ? null : amountOwed)}
      >
        {isPaid ? '✓ Paid' : 'Mark Paid'}
      </Button>
    </div>
  );
}

function PaymentRow({
  guest, costPerHead, onRecord,
}: {
  guest: Guest; costPerHead: number;
  onRecord: (userId: string, amountOwed: number, amountPaid: number | null) => void;
}) {
  const [editingAmount, setEditingAmount] = useState(false);
  const [customAmount, setCustomAmount] = useState('');
  const amountOwed = guest.payment?.amount || costPerHead;
  const amountPaid = guest.payment?.amountPaid;
  const isPaid = guest.payment?.paid;

  return (
    <div className="flex items-center justify-between px-4 py-2 rounded-lg border">
      <div className="flex items-center gap-3">
        <span className="font-medium">{guest.name}</span>
        <span className="text-sm text-muted-foreground">${amountOwed.toFixed(2)}</span>
        {isPaid && amountPaid != null && amountPaid !== amountOwed && (
          <span className="text-xs text-muted-foreground">(paid ${amountPaid.toFixed(2)})</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!isPaid && editingAmount ? (
          <>
            <input
              type="number" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
              className="w-20 border rounded px-2 py-0.5 text-sm"
              placeholder={amountOwed.toFixed(2)} autoFocus
            />
            <Button size="sm" onClick={() => {
              onRecord(guest.userId, amountOwed, parseFloat(customAmount) || amountOwed);
              setEditingAmount(false);
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingAmount(false)}>✕</Button>
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
              variant={isPaid ? 'default' : 'outline'} size="sm"
              onClick={() => onRecord(guest.userId, amountOwed, isPaid ? null : amountOwed)}
            >
              {isPaid ? '✓ Paid' : 'Mark Paid'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function CostSection({
  totalCost, splitCount, presets, onUpdate, onSavePreset, onApplyPreset,
}: {
  totalCost: number | null; splitCount: number; presets: Preset[];
  onUpdate: (t: number, s: number) => void;
  onSavePreset: () => void;
  onApplyPreset: (p: Preset) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [cost, setCost] = useState(String(totalCost ?? ''));
  const [split, setSplit] = useState(String(splitCount));
  const costPerHead = totalCost != null ? (totalCost / splitCount).toFixed(2) : null;

  if (!editing) return (
    <div className="flex items-center gap-3 flex-wrap text-sm">
      <span className="text-muted-foreground">Run cost:</span>
      <button onClick={() => setEditing(true)} className="font-medium underline decoration-dotted">
        {totalCost != null ? `$${totalCost.toFixed(2)} ÷ ${splitCount}` : 'Set cost'}
      </button>
      {costPerHead && (
        <span className="text-muted-foreground">= ${costPerHead} / head</span>
      )}
      {presets.length > 0 && (
        <select
          className="text-xs border rounded px-1 py-0.5 text-muted-foreground"
          defaultValue=""
          onChange={e => {
            const p = presets[parseInt(e.target.value)];
            if (p) onApplyPreset(p);
            e.target.value = '';
          }}
        >
          <option value="">Apply preset…</option>
          {presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
        </select>
      )}
      {totalCost != null && (
        <button onClick={onSavePreset} className="text-xs text-muted-foreground underline decoration-dotted">
          Save as preset
        </button>
      )}
    </div>
  );

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">$</span>
      <input
        type="number" value={cost} onChange={e => setCost(e.target.value)}
        className="w-20 border rounded px-2 py-0.5" placeholder="120" autoFocus
      />
      <span className="text-muted-foreground">÷</span>
      <input
        type="number" value={split} onChange={e => setSplit(e.target.value)}
        className="w-16 border rounded px-2 py-0.5"
      />
      <Button size="sm" onClick={() => {
        onUpdate(parseFloat(cost), parseInt(split) || 12);
        setEditing(false);
      }}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>✕</Button>
    </div>
  );
}

function NotesField({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  if (!editing) return (
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
        value={val} onChange={e => setVal(e.target.value)}
        className="w-full border rounded px-2 py-1 text-sm min-h-[60px]" autoFocus
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => { onSave(val); setEditing(false); }}>Save</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function RsvpBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
    GOING: 'default', MAYBE: 'secondary', NOT_GOING: 'destructive',
  };
  return <Badge variant={variants[status] ?? 'secondary'}>{status}</Badge>;
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/app/runs/[id]/page.tsx
git commit -m "feat: run detail — cost inputs, notes, custom payments, waitlist, quick-add, presets"
```

---

## Task 12: Dashboard balance summary

**Files:** Modify `src/app/page.tsx`

- [ ] **Step 1: Replace `src/app/page.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PartifulEvent { id: string; title: string; startDate: string | null; status: string }
interface PlayerBalance { userId: string; name: string; displayName: string | null; balance: number }

export default function Dashboard() {
  const [upcoming, setUpcoming] = useState<PartifulEvent[]>([]);
  const [past, setPast] = useState<PartifulEvent[]>([]);
  const [players, setPlayers] = useState<PlayerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch('/api/runs'), fetch('/api/players')])
      .then(async ([runsRes, playersRes]) => {
        if (!runsRes.ok) throw new Error(`Failed to load runs: ${runsRes.status}`);
        const d = await runsRes.json();
        setUpcoming(d.upcoming);
        setPast(d.past);
        if (playersRes.ok) setPlayers(await playersRes.json());
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading runs...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  const owing = players.filter(p => p.balance < 0);
  const totalOutstanding = owing.reduce((sum, p) => sum + Math.abs(p.balance), 0);
  const followUp = owing.filter(p => p.balance < -10);

  return (
    <div className="space-y-8">
      {owing.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Outstanding</h2>
            <span className="text-destructive font-bold">${totalOutstanding.toFixed(2)}</span>
            <span className="text-sm text-muted-foreground">
              ({owing.length} player{owing.length !== 1 ? 's' : ''})
            </span>
          </div>
          {followUp.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 space-y-1">
              <p className="text-sm font-medium text-destructive">Needs follow-up (&gt;$10)</p>
              {followUp.map(p => (
                <div key={p.userId} className="flex items-center justify-between text-sm">
                  <Link href={`/players/${p.userId}`} className="hover:underline">
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

      <div>
        <h1 className="text-2xl font-bold mb-4">Upcoming Runs</h1>
        {upcoming.length === 0 && <p className="text-muted-foreground">No upcoming runs.</p>}
        <div className="grid gap-3">
          {upcoming.map(event => <EventCard key={event.id} event={event} />)}
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-4">Past Runs</h2>
        {past.length === 0 && <p className="text-muted-foreground">No past runs.</p>}
        <div className="grid gap-3">
          {past.slice(0, 10).map(event => <EventCard key={event.id} event={event} />)}
        </div>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: PartifulEvent }) {
  const date = event.startDate ? new Date(event.startDate).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : 'TBD';
  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">{event.title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-0.5">{date}</p>
          </div>
          <Link href={`/runs/${event.id}`}>
            <Button variant="outline" size="sm">Manage</Button>
          </Link>
        </div>
      </CardHeader>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: dashboard shows outstanding balance summary and follow-up list"
```

---

## Task 13: Calendar page and nav update

**Files:**
- Create: `src/app/calendar/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create `src/app/calendar/page.tsx`**

```typescript
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface CalRun { id: string; title: string; startDate: string }

export default function CalendarPage() {
  const [runs, setRuns] = useState<CalRun[]>([]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-indexed

  useEffect(() => {
    fetch('/api/runs')
      .then(r => r.json())
      .then(data => {
        const all = [...data.upcoming, ...data.past];
        setRuns(all.filter((e: any) => e.startDate).map((e: any) => ({
          id: e.id, title: e.title, startDate: e.startDate,
        })));
      });
  }, []);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };
  const goToday = () => { const n = new Date(); setYear(n.getFullYear()); setMonth(n.getMonth()); };

  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-CA', {
    month: 'long', year: 'numeric',
  });

  // Build week rows: start from Monday of the week containing the 1st
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  const dow = (firstDay.getDay() + 6) % 7; // Mon=0, Sun=6
  startDate.setDate(firstDay.getDate() - dow);

  const weeks: Date[][] = [];
  const cursor = new Date(startDate);
  while (cursor <= lastDay || weeks.length < 4) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > lastDay && weeks.length >= 4) break;
  }

  // Map dateStr (YYYY-MM-DD) -> run
  const runByDate = new Map<string, CalRun>();
  for (const r of runs) {
    runByDate.set(r.startDate.slice(0, 10), r);
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{monthLabel}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth}>←</Button>
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="outline" size="sm" onClick={nextMonth}>→</Button>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted text-muted-foreground text-xs text-center border-b">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} className="py-2 font-medium">{d}</div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div key={wi} className={`grid grid-cols-7 ${wi > 0 ? 'border-t' : ''}`}>
            {week.map((day, di) => {
              const ds = day.toISOString().slice(0, 10);
              const run = runByDate.get(ds);
              const inMonth = day.getMonth() === month;
              const isToday = ds === todayStr;

              return (
                <div
                  key={di}
                  className={`min-h-[64px] p-1.5 ${di < 6 ? 'border-r' : ''} ${!inMonth ? 'bg-muted/20' : ''}`}
                >
                  <span className={`inline-flex items-center justify-center text-xs w-6 h-6 rounded-full font-medium
                    ${isToday ? 'bg-primary text-primary-foreground' : !inMonth ? 'text-muted-foreground' : ''}`}>
                    {day.getDate()}
                  </span>
                  {run && (
                    <Link href={`/runs/${run.id}`}>
                      <div className="mt-1 px-1.5 py-0.5 rounded text-xs bg-primary text-primary-foreground truncate leading-tight">
                        {run.title}
                      </div>
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update `src/app/layout.tsx` to add Calendar nav link**

```typescript
import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = { title: 'VBall Tracker' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <nav className="border-b px-6 py-3 flex items-center gap-6">
          <span className="font-semibold text-lg">🏐 VBall Tracker</span>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Runs</Link>
          <Link href="/calendar" className="text-sm text-muted-foreground hover:text-foreground">Calendar</Link>
          <Link href="/players" className="text-sm text-muted-foreground hover:text-foreground">Players</Link>
        </nav>
        <main className="px-6 py-8 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Full build check**

```bash
npm run build 2>&1 | tail -30
```

Expected: Compiled successfully.

- [ ] **Step 4: Commit**

```bash
git add src/app/calendar/page.tsx src/app/layout.tsx
git commit -m "feat: calendar month grid view, Calendar added to nav"
```

---

## Verification Checklist

After all tasks complete, run `npm run dev` and manually verify:

- [ ] Dashboard loads; shows "Outstanding" section when players have negative balance
- [ ] Dashboard "Needs follow-up" shows players owing >$10
- [ ] Nav shows: Runs | Calendar | Players
- [ ] Run detail: Payments tab shows cost input as `$X ÷ Y = $Z / head`
- [ ] Run detail: clicking cost opens edit fields; saving updates per-head
- [ ] Run detail: "Save as preset" saves to settings; "Apply preset…" dropdown restores cost
- [ ] Run detail: Payments tab "custom" link → custom amount input → saves amountPaid
- [ ] Run detail: notes field below title is editable
- [ ] Run detail: "Sync Partiful" creates GOING-only payment records for new run
- [ ] Run detail: "Add Guest" creates manual- player visible in guest list with "manual" badge
- [ ] Run detail: WAITLIST guests shown in separate section (if Partiful returns them)
- [ ] Calendar: month grid renders with correct weeks; today is highlighted
- [ ] Calendar: prev/next/today navigation works; run dates show chips
- [ ] Calendar: clicking a run chip navigates to that run
- [ ] Players list: balance shown (owed/credit/—); displayName shown; clicking row → profile
- [ ] Player profile: clicking name opens edit; saving displayName persists
- [ ] Player profile: Partiful name shown as subtitle when displayName set
- [ ] Player profile: balance shown in red/green
- [ ] Player profile: run history table shows all GOING runs with owed/paid/status
- [ ] Player profile: Mark Paid toggle works; balance updates immediately
- [ ] Player profile: "custom" amount on run row records different amountPaid
- [ ] Player profile: "Copy reminder" copies message to clipboard
- [ ] Player profile: notes editable and persisted
