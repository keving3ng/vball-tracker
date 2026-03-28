# Volleyball Tracker App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted Next.js web app for managing volleyball private runs — syncing guest lists from Partiful, tracking attendance and payments, and showing player history — packaged as a Docker container.

**Architecture:** Next.js 14 App Router fullstack app with API routes serving a React UI. SQLite (via better-sqlite3) persists local data (attendance, payments) that Partiful doesn't store. Firebase ID tokens are auto-refreshed using a long-lived refresh token stored in `.env`.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, better-sqlite3, Docker (multi-stage build)

---

## File Map

### Migrated from existing code
- `src/lib/partiful.ts` ← from `src/partiful.ts` (updated imports)
- `src/lib/firestore.ts` ← from `src/firestore.ts` (no changes)

### New files
- `src/lib/auth.ts` — Firebase token refresh; exposes `getValidToken()`
- `src/lib/db.ts` — SQLite schema init + typed query helpers
- `src/app/layout.tsx` — Root layout with nav
- `src/app/page.tsx` — Dashboard: upcoming runs pulled from Partiful
- `src/app/runs/[id]/page.tsx` — Run detail: guests, attendance, payments
- `src/app/players/page.tsx` — Player history + leaderboard
- `src/app/api/runs/route.ts` — `GET` upcoming runs from Partiful
- `src/app/api/runs/[id]/route.ts` — `GET` single run + local data
- `src/app/api/runs/[id]/sync/route.ts` — `POST` sync guests from Partiful/Firestore
- `src/app/api/runs/[id]/attendance/route.ts` — `POST` mark/unmark attendance
- `src/app/api/runs/[id]/payments/route.ts` — `POST` upsert payment record
- `src/app/api/players/route.ts` — `GET` all players with stats
- `Dockerfile` — Multi-stage build (node:22-alpine)
- `docker-compose.yml` — Single service with volume mount for SQLite
- `.dockerignore`

---

## Task 1: Reinitialize as Next.js project

**Files:**
- Replace: `package.json`
- Replace: `tsconfig.json`
- Create: `next.config.ts`
- Create: `.env.example`
- Move: `src/partiful.ts` → `src/lib/partiful.ts`
- Move: `src/firestore.ts` → `src/lib/firestore.ts`
- Delete: `src/test-partiful.ts`

- [ ] **Step 1: Remove old deps and reinit**

```bash
rm -rf node_modules package-lock.json
npm init -y
npm install next@14 react react-dom
npm install better-sqlite3 dotenv
npm install -D typescript @types/node @types/react @types/react-dom @types/better-sqlite3 ts-node
```

- [ ] **Step 2: Replace package.json scripts**

Set `package.json` scripts to:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test:partiful": "npx tsx src/lib/test-partiful.ts"
  }
}
```

Do NOT set `"type": "module"` — Next.js standalone output and `better-sqlite3` both require CommonJS module resolution. Omit the field entirely.

Also install `tsx` for running TypeScript scripts outside Next.js:
```bash
npm install -D tsx
```

- [ ] **Step 3: Replace tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
```

Note: `output: 'standalone'` is required for the Dockerfile. `serverExternalPackages` prevents Next.js from bundling the native SQLite module.

- [ ] **Step 5: Create src/lib/ and move existing files**

```bash
mkdir -p src/lib
mv src/partiful.ts src/lib/partiful.ts
mv src/firestore.ts src/lib/firestore.ts
mv src/test-partiful.ts src/lib/test-partiful.ts
```

- [ ] **Step 6: Update import in partiful.ts**

In `src/lib/partiful.ts`, change:
```typescript
import { deserializeGuest, type Guest } from './firestore';
```
(path is already relative, stays the same — no change needed since both are now in `src/lib/`)

- [ ] **Step 7: Update .env.example**

```
PARTIFUL_REFRESH_TOKEN=your_refresh_token_here
FIREBASE_API_KEY=AIzaSyCky6PJ7cHRdBKk5X7gjuWERWaKWBHr4_k
DATA_DIR=/data
```

Note: `DATA_DIR` is the directory where `vball.db` will be created. Defaults to `/data` in Docker, can be `.` locally.

- [ ] **Step 8: Run dev server to verify Next.js works**

```bash
npm run dev
```
Expected: Server starts on http://localhost:3000 (404 is fine — no pages yet)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: reinitialize as Next.js 14 project"
```

---

## Task 2: Auth module — auto-refreshing Firebase tokens

**Files:**
- Create: `src/lib/auth.ts`

The Firebase token refresh endpoint accepts a refresh token and returns a fresh ID token. Token is cached in memory and only refreshed when within 5 minutes of expiry.

- [ ] **Step 1: Create src/lib/auth.ts**

```typescript
let cachedToken: string | null = null;
let tokenExpiry: number = 0;

function getTokenExpiry(token: string): number {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  return payload.exp * 1000; // convert to ms
}

export async function getValidToken(): Promise<string> {
  const now = Date.now();
  const fiveMin = 5 * 60 * 1000;

  if (cachedToken && tokenExpiry - now > fiveMin) {
    return cachedToken;
  }

  const refreshToken = process.env.PARTIFUL_REFRESH_TOKEN;
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!refreshToken || !apiKey) {
    throw new Error('PARTIFUL_REFRESH_TOKEN and FIREBASE_API_KEY must be set in .env');
  }

  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  cachedToken = data.id_token;
  tokenExpiry = getTokenExpiry(cachedToken!);
  return cachedToken!;
}
```

- [ ] **Step 2: Update partiful.ts to use getValidToken()**

In `src/lib/partiful.ts`, replace the `getToken()` function and all its usages:

Remove:
```typescript
import 'dotenv/config';

function getToken(): string {
  const token = process.env.PARTIFUL_AUTH_TOKEN;
  if (!token) throw new Error('PARTIFUL_AUTH_TOKEN not set in .env');
  return token;
}
```

Add at top:
```typescript
import { getValidToken } from './auth';
```

Update `post()` to be async-aware (it already is):
```typescript
async function post(endpoint: string, params: Record<string, unknown> = {}) {
  const token = await getValidToken();
  const userId = decodeUserId(token);
  // ... rest stays the same
}
```

Update `getContacts()` and `firestoreBatchGet()` similarly — replace `getToken()` calls with `await getValidToken()`.

- [ ] **Step 3: Update .env with real values**

Add to `.env`:
```
PARTIFUL_REFRESH_TOKEN=<paste full refresh token here>
FIREBASE_API_KEY=AIzaSyCky6PJ7cHRdBKk5X7gjuWERWaKWBHr4_k
DATA_DIR=.
```

Remove `PARTIFUL_AUTH_TOKEN` — it's no longer needed.

- [ ] **Step 4: Smoke-test auth**

```bash
npm run test:partiful -- fZze0vVmmgdXh55ovvsU
```
Expected: All tests pass, token refreshes automatically.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/partiful.ts .env.example
git commit -m "feat: auto-refreshing Firebase token via refresh token"
```

---

## Task 3: SQLite database

**Files:**
- Create: `src/lib/db.ts`

- [ ] **Step 1: Create src/lib/db.ts**

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
    eventId   TEXT NOT NULL REFERENCES runs(eventId),
    userId    TEXT NOT NULL REFERENCES players(userId),
    rsvpStatus TEXT NOT NULL DEFAULT 'GOING',
    attended  INTEGER NOT NULL DEFAULT 0,
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
`);

export interface Player { userId: string; name: string }
export interface Run { eventId: string; title: string; startDate: string | null; capacity: number | null; costPerHead: number | null; syncedAt: string | null }
export interface AttendanceRow { eventId: string; userId: string; rsvpStatus: string; attended: boolean }
export interface PaymentRow { eventId: string; userId: string; amount: number; paid: boolean; method: string | null; note: string | null }

export const queries = {
  upsertPlayer: db.prepare(`
    INSERT INTO players (userId, name, updatedAt)
    VALUES (@userId, @name, datetime('now'))
    ON CONFLICT(userId) DO UPDATE SET name=excluded.name, updatedAt=excluded.updatedAt
  `),

  upsertRun: db.prepare(`
    INSERT INTO runs (eventId, title, startDate, syncedAt)
    VALUES (@eventId, @title, @startDate, datetime('now'))
    ON CONFLICT(eventId) DO UPDATE SET title=excluded.title, startDate=excluded.startDate, syncedAt=excluded.syncedAt
  `),

  updateRunSettings: db.prepare(`
    UPDATE runs SET capacity=@capacity, costPerHead=@costPerHead WHERE eventId=@eventId
  `),

  upsertAttendance: db.prepare(`
    INSERT INTO attendance (eventId, userId, rsvpStatus)
    VALUES (@eventId, @userId, @rsvpStatus)
    ON CONFLICT(eventId, userId) DO UPDATE SET rsvpStatus=excluded.rsvpStatus
  `),

  setAttended: db.prepare(`
    UPDATE attendance SET attended=@attended WHERE eventId=@eventId AND userId=@userId
  `),

  upsertPayment: db.prepare(`
    INSERT INTO payments (eventId, userId, amount, paid, method, note)
    VALUES (@eventId, @userId, @amount, @paid, @method, @note)
    ON CONFLICT(eventId, userId) DO UPDATE SET
      amount=excluded.amount, paid=excluded.paid, method=excluded.method, note=excluded.note
  `),

  getRunWithGuests: db.prepare(`
    SELECT
      r.*,
      a.userId, a.rsvpStatus, a.attended,
      p.name,
      pay.amount, pay.paid, pay.method, pay.note
    FROM runs r
    LEFT JOIN attendance a ON a.eventId = r.eventId
    LEFT JOIN players p ON p.userId = a.userId
    LEFT JOIN payments pay ON pay.eventId = r.eventId AND pay.userId = a.userId
    WHERE r.eventId = ?
    ORDER BY a.rsvpStatus, p.name
  `),

  getPlayerStats: db.prepare(`
    SELECT
      p.userId,
      p.name,
      COUNT(a.eventId) as totalRuns,
      SUM(a.attended) as attended,
      SUM(CASE WHEN pay.paid = 1 THEN 1 ELSE 0 END) as paidRuns,
      SUM(CASE WHEN pay.paid = 0 AND pay.amount > 0 THEN 1 ELSE 0 END) as owingRuns,
      SUM(CASE WHEN pay.paid = 0 THEN pay.amount ELSE 0 END) as totalOwing
    FROM players p
    LEFT JOIN attendance a ON a.userId = p.userId
    LEFT JOIN payments pay ON pay.userId = p.userId AND pay.eventId = a.eventId
    GROUP BY p.userId
    ORDER BY attended DESC, totalRuns DESC
  `),
};

export default db;
```

- [ ] **Step 2: Verify DB initializes without error**

```bash
DATA_DIR=. npx ts-node --esm -e "import './src/lib/db.ts'; console.log('DB OK')"
```
Expected: `DB OK` and a `vball.db` file appears.

- [ ] **Step 3: Commit**

```bash
git add src/lib/db.ts
git commit -m "feat: SQLite schema with players, runs, attendance, payments"
```

---

## Task 4: Install and configure Tailwind + shadcn/ui

- [ ] **Step 1: Install Tailwind**

```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

- [ ] **Step 2: Create src/app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Update tailwind.config.js content array**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 4: Init shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted:
- Style: Default
- Base color: Slate
- CSS variables: Yes

- [ ] **Step 5: Add needed components**

```bash
npx shadcn@latest add badge button card table tabs
```

- [ ] **Step 6: Create root layout src/app/layout.tsx**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'VBall Tracker' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <nav className="border-b px-6 py-3 flex items-center gap-6">
          <span className="font-semibold text-lg">🏐 VBall Tracker</span>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">Runs</a>
          <a href="/players" className="text-sm text-muted-foreground hover:text-foreground">Players</a>
        </nav>
        <main className="px-6 py-8 max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Create placeholder src/app/page.tsx**

```tsx
export default function Home() {
  return <p>Dashboard coming soon</p>;
}
```

- [ ] **Step 8: Verify dev server renders**

```bash
npm run dev
```
Open http://localhost:3000 — should see nav and "Dashboard coming soon".

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Tailwind + shadcn/ui setup with root layout"
```

---

## Task 5: API routes

**Files:**
- Create: `src/app/api/runs/route.ts`
- Create: `src/app/api/runs/[id]/route.ts`
- Create: `src/app/api/runs/[id]/sync/route.ts`
- Create: `src/app/api/runs/[id]/attendance/route.ts`
- Create: `src/app/api/runs/[id]/payments/route.ts`
- Create: `src/app/api/players/route.ts`

- [ ] **Step 1: Create src/app/api/runs/route.ts**

Returns upcoming events from Partiful.

```typescript
import { NextResponse } from 'next/server';
import { getUpcomingEvents, getPastEvents } from '@/lib/partiful';

export async function GET() {
  const [upcoming, past] = await Promise.all([getUpcomingEvents(), getPastEvents()]);
  return NextResponse.json({
    upcoming: upcoming.result.data.upcomingEvents ?? [],
    past: past.result.data.pastEvents ?? [],
  });
}
```

- [ ] **Step 2: Create src/app/api/runs/[id]/route.ts**

Returns a single run's local data (from SQLite).

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const rows = queries.getRunWithGuests.all(params.id) as any[];
  if (!rows.length) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const run = {
    eventId: rows[0].eventId,
    title: rows[0].title,
    startDate: rows[0].startDate,
    capacity: rows[0].capacity,
    costPerHead: rows[0].costPerHead,
    syncedAt: rows[0].syncedAt,
    guests: rows
      .filter(r => r.userId)
      .map(r => ({
        userId: r.userId,
        name: r.name,
        rsvpStatus: r.rsvpStatus,
        attended: Boolean(r.attended),
        payment: { amount: r.amount, paid: Boolean(r.paid), method: r.method, note: r.note },
      })),
  };

  return NextResponse.json(run);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  queries.updateRunSettings.run({ eventId: params.id, capacity: body.capacity ?? null, costPerHead: body.costPerHead ?? null });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Create src/app/api/runs/[id]/sync/route.ts**

Pulls guests from Partiful/Firestore and upserts into SQLite.

```typescript
import { NextResponse } from 'next/server';
import { getEventGuests } from '@/lib/partiful';
import { queries } from '@/lib/db';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guests = await getEventGuests(params.id);

  for (const guest of guests) {
    queries.upsertPlayer.run({ userId: guest.userId, name: guest.name });
    queries.upsertAttendance.run({ eventId: params.id, userId: guest.userId, rsvpStatus: guest.status });
  }

  return NextResponse.json({ synced: guests.length });
}
```

- [ ] **Step 4: Create src/app/api/runs/[id]/attendance/route.ts**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId, attended } = await req.json();
  queries.setAttended.run({ eventId: params.id, userId, attended: attended ? 1 : 0 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Create src/app/api/runs/[id]/payments/route.ts**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  queries.upsertPayment.run({
    eventId: params.id,
    userId: body.userId,
    amount: body.amount ?? 0,
    paid: body.paid ? 1 : 0,
    method: body.method ?? null,
    note: body.note ?? null,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Create src/app/api/players/route.ts**

```typescript
import { NextResponse } from 'next/server';
import { queries } from '@/lib/db';

export async function GET() {
  const players = queries.getPlayerStats.all();
  return NextResponse.json(players);
}
```

- [ ] **Step 7: Smoke-test routes with curl**

First, sync an event to populate the DB, then test:

```bash
# Sync guests for your vball event
curl -X POST http://localhost:3000/api/runs/fZze0vVmmgdXh55ovvsU/sync

# Get run data
curl http://localhost:3000/api/runs/fZze0vVmmgdXh55ovvsU

# Get players
curl http://localhost:3000/api/players
```

Expected: sync returns `{"synced": 13}`, run returns guests, players returns stats.

- [ ] **Step 8: Commit**

```bash
git add src/app/api
git commit -m "feat: API routes for runs, sync, attendance, payments, players"
```

---

## Task 6: Dashboard page (upcoming runs)

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Replace src/app/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface PartifulEvent {
  id: string;
  title: string;
  startDate: string | null;
  status: string;
}

export default function Dashboard() {
  const [upcoming, setUpcoming] = useState<PartifulEvent[]>([]);
  const [past, setPast] = useState<PartifulEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/runs')
      .then(r => r.json())
      .then(data => { setUpcoming(data.upcoming); setPast(data.past); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading runs...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold mb-4">Upcoming Runs</h1>
        {upcoming.length === 0 && <p className="text-muted-foreground">No upcoming runs.</p>}
        <div className="grid gap-3">
          {upcoming.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      </div>
      <div>
        <h1 className="text-2xl font-bold mb-4">Past Runs</h1>
        <div className="grid gap-3">
          {past.slice(0, 10).map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: PartifulEvent }) {
  const date = event.startDate ? new Date(event.startDate).toLocaleDateString('en-CA', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
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

- [ ] **Step 2: Verify dashboard loads and shows runs**

Open http://localhost:3000 — should see your events listed with Manage buttons.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: dashboard page with upcoming/past runs from Partiful"
```

---

## Task 7: Run detail page

**Files:**
- Create: `src/app/runs/[id]/page.tsx`

This is the most complex page. It shows:
- Event metadata + settings (capacity, cost)
- Guest list with RSVP status, attendance toggle, payment status
- Sync button to refresh from Partiful
- Summary stats (going, attended, paid)

- [ ] **Step 1: Create src/app/runs/[id]/page.tsx**

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Guest {
  userId: string;
  name: string;
  rsvpStatus: string;
  attended: boolean;
  payment: { amount: number; paid: boolean; method: string | null; note: string | null };
}

interface Run {
  eventId: string;
  title: string;
  startDate: string | null;
  capacity: number | null;
  costPerHead: number | null;
  syncedAt: string | null;
  guests: Guest[];
}

export default function RunPage({ params }: { params: { id: string } }) {
  const [run, setRun] = useState<Run | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // First ensure the run exists in SQLite (sync if not)
    const res = await fetch(`/api/runs/${params.id}`);
    if (res.ok) {
      setRun(await res.json());
    } else {
      // Run not in DB yet — seed it from Partiful
      await sync();
    }
    setLoading(false);
  }, [params.id]);

  const sync = async () => {
    setSyncing(true);
    // Upsert run metadata from Partiful events list
    await fetch('/api/runs').then(r => r.json()).then(async data => {
      const all = [...data.upcoming, ...data.past];
      const event = all.find((e: any) => e.id === params.id);
      if (event) {
        await fetch(`/api/runs/${params.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          // PATCH will upsert run row via /api/runs/[id] PATCH handler calling upsertRun
          body: JSON.stringify({ title: event.title, startDate: event.startDate }),
        });
      }
    });
    await fetch(`/api/runs/${params.id}/sync`, { method: 'POST' });
    const res = await fetch(`/api/runs/${params.id}`);
    if (res.ok) setRun(await res.json());
    setSyncing(false);
  };

  useEffect(() => { load(); }, [load]);

  const toggleAttended = async (userId: string, attended: boolean) => {
    await fetch(`/api/runs/${params.id}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, attended }),
    });
    setRun(prev => prev ? {
      ...prev,
      guests: prev.guests.map(g => g.userId === userId ? { ...g, attended } : g),
    } : prev);
  };

  const togglePaid = async (userId: string, paid: boolean, amount: number) => {
    await fetch(`/api/runs/${params.id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, paid, amount }),
    });
    setRun(prev => prev ? {
      ...prev,
      guests: prev.guests.map(g =>
        g.userId === userId ? { ...g, payment: { ...g.payment, paid } } : g
      ),
    } : prev);
  };

  if (loading) return <p className="text-muted-foreground">Loading...</p>;
  if (!run) return <p className="text-destructive">Run not found</p>;

  const going = run.guests.filter(g => g.rsvpStatus === 'GOING');
  const attended = going.filter(g => g.attended);
  const paid = going.filter(g => g.payment?.paid);
  const costPerHead = run.costPerHead ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{run.title}</h1>
          <p className="text-muted-foreground">
            {run.startDate ? new Date(run.startDate).toLocaleDateString('en-CA', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
              hour: 'numeric', minute: '2-digit',
            }) : 'Date TBD'}
          </p>
        </div>
        <Button onClick={sync} disabled={syncing} variant="outline" size="sm">
          {syncing ? 'Syncing...' : 'Sync Partiful'}
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Going" value={`${going.length}${run.capacity ? ` / ${run.capacity}` : ''}`} />
        <StatCard label="Attended" value={`${attended.length} / ${going.length}`} />
        <StatCard label="Paid" value={`${paid.length} / ${going.length}`} />
      </div>

      <Tabs defaultValue="guests">
        <TabsList>
          <TabsTrigger value="guests">Guest List</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="guests" className="space-y-2 mt-4">
          {going.map(guest => (
            <GuestRow
              key={guest.userId}
              guest={guest}
              onToggleAttended={toggleAttended}
            />
          ))}
          {run.guests.filter(g => g.rsvpStatus !== 'GOING').map(guest => (
            <GuestRow key={guest.userId} guest={guest} onToggleAttended={toggleAttended} dim />
          ))}
        </TabsContent>

        <TabsContent value="payments" className="space-y-2 mt-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Cost per head: </span>
            <CostInput
              value={costPerHead}
              onSave={val => fetch(`/api/runs/${params.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ costPerHead: val, capacity: run.capacity }),
              }).then(() => setRun(prev => prev ? { ...prev, costPerHead: val } : prev))}
            />
          </div>
          {going.map(guest => (
            <PaymentRow
              key={guest.userId}
              guest={guest}
              costPerHead={costPerHead}
              onTogglePaid={togglePaid}
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
  guest, onToggleAttended, dim
}: {
  guest: Guest;
  onToggleAttended: (userId: string, attended: boolean) => void;
  dim?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between px-4 py-2 rounded-lg border ${dim ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="font-medium">{guest.name}</span>
        <RsvpBadge status={guest.rsvpStatus} />
      </div>
      <Button
        variant={guest.attended ? 'default' : 'outline'}
        size="sm"
        onClick={() => onToggleAttended(guest.userId, !guest.attended)}
      >
        {guest.attended ? '✓ Attended' : 'Mark Attended'}
      </Button>
    </div>
  );
}

function PaymentRow({
  guest, costPerHead, onTogglePaid
}: {
  guest: Guest;
  costPerHead: number;
  onTogglePaid: (userId: string, paid: boolean, amount: number) => void;
}) {
  const amount = guest.payment?.amount || costPerHead;
  return (
    <div className="flex items-center justify-between px-4 py-2 rounded-lg border">
      <div className="flex items-center gap-3">
        <span className="font-medium">{guest.name}</span>
        <span className="text-sm text-muted-foreground">${amount.toFixed(2)}</span>
      </div>
      <Button
        variant={guest.payment?.paid ? 'default' : 'outline'}
        size="sm"
        onClick={() => onTogglePaid(guest.userId, !guest.payment?.paid, amount)}
      >
        {guest.payment?.paid ? '✓ Paid' : 'Mark Paid'}
      </Button>
    </div>
  );
}

function RsvpBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
    GOING: 'default', MAYBE: 'secondary', NOT_GOING: 'destructive',
  };
  return <Badge variant={variants[status] ?? 'secondary'}>{status}</Badge>;
}

function CostInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  if (!editing) return (
    <button onClick={() => setEditing(true)} className="text-sm font-medium underline decoration-dotted">
      ${value.toFixed(2)}
    </button>
  );
  return (
    <div className="flex gap-2">
      <input
        type="number"
        value={val}
        onChange={e => setVal(e.target.value)}
        className="w-20 border rounded px-2 py-0.5 text-sm"
        autoFocus
      />
      <Button size="sm" onClick={() => { onSave(parseFloat(val)); setEditing(false); }}>Save</Button>
    </div>
  );
}
```

- [ ] **Step 2: Update PATCH handler in /api/runs/[id]/route.ts to also upsert run**

Add `upsertRun` to the PATCH handler so it creates the run row if missing:

```typescript
import { queries } from '@/lib/db';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  if (body.title) {
    queries.upsertRun.run({ eventId: params.id, title: body.title, startDate: body.startDate ?? null });
  }
  if (body.capacity !== undefined || body.costPerHead !== undefined) {
    queries.updateRunSettings.run({ eventId: params.id, capacity: body.capacity ?? null, costPerHead: body.costPerHead ?? null });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Test run detail page**

Navigate to http://localhost:3000/runs/fZze0vVmmgdXh55ovvsU — should auto-sync and show guests with Attended/Paid toggles.

- [ ] **Step 4: Commit**

```bash
git add src/app/runs
git commit -m "feat: run detail page with attendance and payment tracking"
```

---

## Task 8: Players history page

**Files:**
- Create: `src/app/players/page.tsx`

- [ ] **Step 1: Create src/app/players/page.tsx**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PlayerStats {
  userId: string;
  name: string;
  totalRuns: number;
  attended: number;
  paidRuns: number;
  owingRuns: number;
  totalOwing: number;
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/players')
      .then(r => r.json())
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
              <th className="text-center px-4 py-2 font-medium">Runs RSVPd</th>
              <th className="text-center px-4 py-2 font-medium">Attended</th>
              <th className="text-center px-4 py-2 font-medium">Show Rate</th>
              <th className="text-center px-4 py-2 font-medium">Owing</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={p.userId} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/30'}>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-center">{p.totalRuns}</td>
                <td className="px-4 py-2 text-center">{p.attended}</td>
                <td className="px-4 py-2 text-center">
                  {p.totalRuns > 0
                    ? `${Math.round((p.attended / p.totalRuns) * 100)}%`
                    : '—'}
                </td>
                <td className="px-4 py-2 text-center">
                  {p.totalOwing > 0 ? (
                    <span className="text-destructive font-medium">${p.totalOwing.toFixed(2)}</span>
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

- [ ] **Step 2: Verify players page**

Open http://localhost:3000/players — should show player stats table.

- [ ] **Step 3: Commit**

```bash
git add src/app/players
git commit -m "feat: players history page with attendance and payment stats"
```

---

## Task 9: Dockerfile + docker-compose

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:22-alpine AS base

# Build stage
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  vball-tracker:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - .env
    volumes:
      - vball-data:/data
    restart: unless-stopped

volumes:
  vball-data:
```

- [ ] **Step 3: Create .dockerignore**

```
node_modules
.next
.env
*.db
docs
src/lib/test-partiful.ts
```

- [ ] **Step 4: Build and run**

```bash
docker compose up --build
```

Expected: App accessible at http://localhost:3000

- [ ] **Step 5: Verify data persists across restart**

```bash
docker compose restart
# Open browser — runs and player data should still be there
```

- [ ] **Step 6: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "feat: Docker multi-stage build with SQLite volume"
```

---

## Done

At this point you have:
- Auto-refreshing Partiful auth (no manual token updates)
- Dashboard showing all your upcoming/past runs
- Run detail page: sync from Partiful, mark attendance, track payments
- Players page: attendance rates and outstanding payments
- Fully Dockerized, SQLite-backed, ready to deploy on home server with `docker compose up`
