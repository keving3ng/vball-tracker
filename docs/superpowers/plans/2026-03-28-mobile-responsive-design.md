# Mobile Responsive Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all six pages usable on mobile phones by adding Tailwind responsive classes, with no functionality or backend changes.

**Architecture:** Mobile-first approach using Tailwind's `sm:` breakpoint (640px) throughout. Desktop layouts are preserved exactly; mobile gets stacked/simplified layouts via `flex-col` and dual-render patterns (`sm:hidden` / `hidden sm:block`). No new components — all changes are inline class additions or minor JSX restructuring within existing components.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS v3, shadcn/ui

---

## Files Modified

- `src/app/layout.tsx` — nav padding + flex-wrap
- `src/app/page.tsx` — outstanding header wrap, EventCard title truncation
- `src/app/runs/[id]/page.tsx` — header stack, GuestRow stack, PaymentRow stack, CostSection wrap, add-guest min-w-0
- `src/app/players/page.tsx` — dual-render: mobile card stack + desktop table
- `src/app/players/[id]/page.tsx` — profile header stack, name input width, run history dual-render
- `src/app/calendar/page.tsx` — dual-render: mobile list view + desktop grid

---

### Task 1: layout.tsx — nav and main padding

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Update nav and main classes**

Replace the existing nav and main elements:

```tsx
<nav className="border-b px-4 py-3 flex items-center flex-wrap gap-x-6 gap-y-2 sm:px-6">
  <span className="font-semibold text-lg">🏐 VBall Tracker</span>
  <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Runs</Link>
  <Link href="/calendar" className="text-sm text-muted-foreground hover:text-foreground">Calendar</Link>
  <Link href="/players" className="text-sm text-muted-foreground hover:text-foreground">Players</Link>
</nav>
<main className="px-4 py-6 max-w-5xl mx-auto sm:px-6 sm:py-8">{children}</main>
```

- [ ] **Step 2: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: mobile-responsive nav and main padding"
```

---

### Task 2: page.tsx — Dashboard outstanding header + EventCard

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Fix outstanding header row to wrap on narrow screens**

The current header row is:
```tsx
<div className="flex items-center gap-4">
  <h2 className="text-lg font-semibold">Outstanding</h2>
  <span className="text-destructive font-bold">${totalOutstanding.toFixed(2)}</span>
  <span className="text-sm text-muted-foreground">
    ({owing.length} player{owing.length !== 1 ? 's' : ''})
  </span>
</div>
```

Replace with:
```tsx
<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
  <h2 className="text-lg font-semibold">Outstanding</h2>
  <span className="text-destructive font-bold">${totalOutstanding.toFixed(2)}</span>
  <span className="text-sm text-muted-foreground">
    ({owing.length} player{owing.length !== 1 ? 's' : ''})
  </span>
</div>
```

- [ ] **Step 2: Fix EventCard title/button row to prevent button being pushed off-screen**

The current EventCard inner div is:
```tsx
<div className="flex items-center justify-between">
  <div>
    <CardTitle className="text-base">{event.title}</CardTitle>
    <p className="text-sm text-muted-foreground mt-0.5">{date}</p>
  </div>
  <Link href={`/runs/${event.id}`}>
    <Button variant="outline" size="sm">Manage</Button>
  </Link>
</div>
```

Replace with:
```tsx
<div className="flex items-start justify-between gap-2">
  <div className="min-w-0">
    <CardTitle className="text-base truncate">{event.title}</CardTitle>
    <p className="text-sm text-muted-foreground mt-0.5">{date}</p>
  </div>
  <Link href={`/runs/${event.id}`} className="shrink-0">
    <Button variant="outline" size="sm">Manage</Button>
  </Link>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: mobile-responsive dashboard outstanding header and event cards"
```

---

### Task 3: runs/[id]/page.tsx — header, GuestRow, PaymentRow, CostSection, add-guest

**Files:**
- Modify: `src/app/runs/[id]/page.tsx`

- [ ] **Step 1: Stack run header on mobile**

Current header:
```tsx
<div className="flex items-start justify-between">
  <div className="space-y-1 flex-1 mr-4">
    ...
  </div>
  <Button onClick={sync} disabled={syncing} variant="outline" size="sm">
    {syncing ? 'Syncing...' : 'Sync Partiful'}
  </Button>
</div>
```

Replace with:
```tsx
<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
  <div className="space-y-1">
    ...
  </div>
  <Button onClick={sync} disabled={syncing} variant="outline" size="sm" className="self-start">
    {syncing ? 'Syncing...' : 'Sync Partiful'}
  </Button>
</div>
```

(Keep the inner content of the first div identical — `h1`, `p`, `NotesField`.)

- [ ] **Step 2: Stack GuestRow on mobile**

Current GuestRow return:
```tsx
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
```

Replace with:
```tsx
<div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-2 rounded-lg border gap-2 ${dim ? 'opacity-50' : ''}`}>
  <div className="flex items-center gap-3">
    <span className="font-medium">{guest.name}</span>
    <RsvpBadge status={guest.rsvpStatus} />
    {guest.userId.startsWith('manual-') && (
      <span className="text-xs text-muted-foreground bg-muted px-1 rounded">manual</span>
    )}
  </div>
  <Button
    variant={isPaid ? 'default' : 'outline'} size="sm"
    className="self-start sm:self-auto"
    onClick={() => onRecord(guest.userId, amountOwed, isPaid ? null : amountOwed)}
  >
    {isPaid ? '✓ Paid' : 'Mark Paid'}
  </Button>
</div>
```

- [ ] **Step 3: Stack PaymentRow on mobile**

Current PaymentRow return outer div:
```tsx
<div className="flex items-center justify-between px-4 py-2 rounded-lg border">
  <div className="flex items-center gap-3">
    <span className="font-medium">{guest.name}</span>
    <span className="text-sm text-muted-foreground">${amountOwed.toFixed(2)}</span>
    {isPaid && amountPaid != null && amountPaid !== amountOwed && (
      <span className="text-xs text-muted-foreground">(paid ${amountPaid.toFixed(2)})</span>
    )}
  </div>
  <div className="flex items-center gap-2">
    ...
  </div>
</div>
```

Replace with:
```tsx
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-2 rounded-lg border gap-2">
  <div className="flex items-center gap-3">
    <span className="font-medium">{guest.name}</span>
    <span className="text-sm text-muted-foreground">${amountOwed.toFixed(2)}</span>
    {isPaid && amountPaid != null && amountPaid !== amountOwed && (
      <span className="text-xs text-muted-foreground">(paid ${amountPaid.toFixed(2)})</span>
    )}
  </div>
  <div className="flex items-center gap-2 self-start sm:self-auto">
    ...
  </div>
</div>
```

(The inner `<div className="flex items-center gap-2">` content stays identical.)

- [ ] **Step 4: Wrap CostSection edit mode**

The edit-mode return in CostSection:
```tsx
<div className="flex items-center gap-2 text-sm">
```

Replace with:
```tsx
<div className="flex flex-wrap items-center gap-2 text-sm">
```

- [ ] **Step 5: Add min-w-0 to add-guest input**

The input in the add-guest form:
```tsx
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
```

Replace with:
```tsx
<input
  value={newGuestName}
  onChange={e => setNewGuestName(e.target.value)}
  placeholder="Guest name"
  className="border rounded px-2 py-1 text-sm flex-1 min-w-0"
  autoFocus
  onKeyDown={e => {
    if (e.key === 'Enter') addGuest();
    if (e.key === 'Escape') setShowAddGuest(false);
  }}
/>
```

- [ ] **Step 6: Commit**

```bash
git add src/app/runs/[id]/page.tsx
git commit -m "feat: mobile-responsive run detail page"
```

---

### Task 4: players/page.tsx — dual-render mobile cards + desktop table

**Files:**
- Modify: `src/app/players/page.tsx`

- [ ] **Step 1: Replace single table with dual-render layout**

Replace everything inside the `return` after the `<h1>`:

```tsx
return (
  <div className="space-y-6">
    <h1 className="text-2xl font-bold">Players</h1>

    {/* Mobile: card stack */}
    <div className="sm:hidden space-y-2">
      {players.map(p => (
        <Link
          key={p.userId}
          href={`/players/${p.userId}`}
          className="flex items-center justify-between px-4 py-3 rounded-lg border hover:bg-muted/50"
        >
          <div>
            <span className="font-medium">
              {p.displayName ?? p.name}
            </span>
            {p.displayName && (
              <span className="ml-1 text-xs text-muted-foreground">({p.name})</span>
            )}
            <p className="text-xs text-muted-foreground">{p.totalRuns} runs</p>
          </div>
          <div className="text-right">
            {p.balance < 0 ? (
              <span className="text-destructive font-medium text-sm">
                ${Math.abs(p.balance).toFixed(2)} owed
              </span>
            ) : p.balance > 0 ? (
              <span className="text-green-600 font-medium text-sm">
                ${p.balance.toFixed(2)} credit
              </span>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        </Link>
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
```

- [ ] **Step 2: Commit**

```bash
git add src/app/players/page.tsx
git commit -m "feat: mobile-responsive players list with card layout"
```

---

### Task 5: players/[id]/page.tsx — profile header stack + run history dual-render

**Files:**
- Modify: `src/app/players/[id]/page.tsx`

- [ ] **Step 1: Stack profile header on mobile**

Current profile header:
```tsx
<div className="flex items-start justify-between">
  <div className="space-y-1">
    ...name editing...
  </div>
  <div className="text-right space-y-1">
    ...balance block...
  </div>
</div>
```

Replace with:
```tsx
<div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
  <div className="space-y-1">
    ...name editing...
  </div>
  <div className="sm:text-right space-y-1">
    ...balance block...
  </div>
</div>
```

(Keep all inner content identical — the name editing block and balance block are unchanged.)

- [ ] **Step 2: Make name edit input full-width on mobile**

Current input:
```tsx
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
```

Replace with:
```tsx
<input
  value={nameVal}
  onChange={e => setNameVal(e.target.value)}
  className="text-2xl font-bold border-b border-input bg-transparent outline-none w-full sm:w-auto"
  autoFocus
  onKeyDown={e => {
    if (e.key === 'Enter') saveName();
    if (e.key === 'Escape') setEditingName(false);
  }}
/>
```

- [ ] **Step 3: Add mobile card view for run history**

Replace the run history section (starting from `<div className="space-y-2">`):

```tsx
<div className="space-y-2">
  <h2 className="font-semibold">Run History</h2>
  {player.runs.length === 0 && (
    <p className="text-sm text-muted-foreground">No runs yet.</p>
  )}
  {player.runs.length > 0 && (
    <>
      {/* Mobile: card per run */}
      <div className="sm:hidden space-y-2">
        {player.runs.map(run => (
          <MobileRunCard key={run.eventId} run={run} onRecord={recordPayment} />
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
    </>
  )}
</div>
```

- [ ] **Step 4: Add MobileRunCard component**

Add this function at the bottom of the file (after `RunHistoryRow`):

```tsx
function MobileRunCard({
  run, onRecord,
}: {
  run: RunEntry;
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
    <div className="rounded-lg border px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/runs/${run.eventId}`} className="font-medium hover:underline truncate block">
            {run.title}
          </Link>
          <p className="text-xs text-muted-foreground">{date}</p>
        </div>
        <Badge
          variant={
            status === 'paid' ? 'default' :
            status === 'partial' ? 'secondary' : 'outline'
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
              onChange={e => setCustomAmount(e.target.value)}
              className="w-20 border rounded px-2 py-0.5 text-sm"
              placeholder={run.amountOwed.toFixed(2)}
              autoFocus
            />
            <Button size="sm" onClick={() => {
              onRecord(run.eventId, run.amountOwed, parseFloat(customAmount) || run.amountOwed);
              setEditingAmount(false);
            }}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingAmount(false)}>✕</Button>
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
              variant={run.paid ? 'default' : 'outline'}
              onClick={() => onRecord(run.eventId, run.amountOwed, run.paid ? null : run.amountOwed)}
            >
              {run.paid ? '✓ Paid' : 'Mark Paid'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/players/[id]/page.tsx
git commit -m "feat: mobile-responsive player profile page"
```

---

### Task 6: calendar/page.tsx — dual-render mobile list + desktop grid

**Files:**
- Modify: `src/app/calendar/page.tsx`

- [ ] **Step 1: Compute mobile month runs list**

Add this computation after `const todayStr = ...`:

```tsx
// Mobile: runs in current month sorted by date
const monthRuns = runs
  .filter(r => {
    const d = new Date(r.startDate);
    return d.getFullYear() === year && d.getMonth() === month;
  })
  .sort((a, b) => a.startDate.localeCompare(b.startDate));
```

- [ ] **Step 2: Replace return with dual-render layout**

Replace the current `return (...)` block:

```tsx
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

    {/* Mobile: list view */}
    <div className="sm:hidden space-y-2">
      {monthRuns.length === 0 ? (
        <p className="text-muted-foreground text-sm">No runs in {monthLabel}.</p>
      ) : (
        monthRuns.map(run => {
          const runDate = new Date(run.startDate).toLocaleDateString('en-CA', {
            weekday: 'short', month: 'short', day: 'numeric',
          });
          return (
            <Link
              key={run.id}
              href={`/runs/${run.id}`}
              className="flex items-center justify-between px-4 py-3 rounded-lg border hover:bg-muted/50"
            >
              <span className="font-medium">{run.title}</span>
              <span className="text-sm text-muted-foreground">{runDate}</span>
            </Link>
          );
        })
      )}
    </div>

    {/* Desktop: grid view */}
    <div className="hidden sm:block rounded-lg border overflow-hidden">
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
```

- [ ] **Step 3: Commit**

```bash
git add src/app/calendar/page.tsx
git commit -m "feat: mobile-responsive calendar with list view"
```

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| Nav flex-wrap + padding | Task 1 |
| Main padding mobile-first | Task 1 |
| Outstanding header flex-wrap | Task 2 |
| EventCard title min-w-0 + truncate | Task 2 |
| Run detail header flex-col | Task 3 |
| GuestRow stack mobile | Task 3 |
| PaymentRow stack mobile | Task 3 |
| CostSection edit flex-wrap | Task 3 |
| Add-guest input min-w-0 | Task 3 |
| Players list mobile cards | Task 4 |
| Players list desktop table unchanged | Task 4 |
| Player profile header stack | Task 5 |
| Name input w-full sm:w-auto | Task 5 |
| Run history mobile cards | Task 5 |
| Run history desktop table unchanged | Task 5 |
| Calendar mobile list view | Task 6 |
| Calendar desktop grid unchanged | Task 6 |
| Calendar empty state message | Task 6 |
