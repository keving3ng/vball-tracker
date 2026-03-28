# VBall Tracker — Feature Expansion Design

**Date:** 2026-03-28
**Approach:** Option A — Incremental, minimal schema additions on existing codebase

---

## Overview

Expand VBall Tracker with cost management, per-player balance tracking, a calendar view, player profile pages with display names, and a set of quality-of-life features. All features are local/personal use; no skill or score tracking.

---

## 1. Schema Changes

Additive `ALTER TABLE` migrations run at startup in `db.ts` via `try/catch` (SQLite does not support `IF NOT EXISTS` on `ALTER TABLE`). A new `settings` table is created normally.

### `runs` table
- Add `totalCost REAL` — total venue cost for the run (e.g. 120.00)
- Add `splitCount INTEGER DEFAULT 12` — number of ways to split the cost (default 12, editable per run)
- Add `notes TEXT` — freetext field for run notes
- `costPerHead` column is kept but no longer written; it is computed as `totalCost / splitCount` in the API response and removed from DB writes going forward

### `players` table
- Add `displayName TEXT` — nullable custom name; all display logic uses `COALESCE(displayName, name)`. The Partiful `name` is never overwritten.
- Add `notes TEXT` — freetext per-player notes (e.g. "Venmos immediately")

### `settings` table (new)
- `key TEXT PRIMARY KEY, value TEXT NOT NULL` — general key/value store
- Used initially for cost presets (key: `costPresets`, value: JSON array)

### `payments` table
- Add `amountPaid REAL` — nullable; null = unpaid, a value = actual amount paid (may differ from amount owed for overpay/underpay)
- `paid` boolean is derived as `amountPaid IS NOT NULL` going forward; existing rows with `paid = 1` are treated as `amountPaid = amount` on read

### Running balance
Computed live from the payments table:

```
balance = SUM(COALESCE(amountPaid, 0) - amount)
```

- Negative = player owes money
- Positive = player has credit
- Surfaced on the players list, player profile, and dashboard summary

---

## 2. Cost & Payments

### Setting cost per run
The run detail Payments tab shows:
- **Run Cost** input — total venue cost (e.g. $120)
- **Split** input — number of people splitting (default 12, adjustable)
- **Per head** — computed inline: `totalCost / splitCount`

When a new run is first synced from Partiful, the API defaults `totalCost` and `splitCount` from the most recent past run that has them set.

### GOING-only billing
Payment records (`amount` row) are only created/updated for guests with `rsvpStatus = 'GOING'`. Maybes and invited guests appear in the guest list (dimmed) but have no payment row and are excluded from the split count denominator.

### Custom payment amount
On the Payments tab, each GOING guest row has an editable amount field (defaults to `costPerHead`). When marking someone paid, the actual amount paid can be entered (e.g. $15 when they owe $10). This stores `amountPaid` separately from `amount` (owed). The difference carries into the running balance.

### Cost presets
A named preset system: save presets like "Weekday $90 / 12" or "Weekend $120 / 10". Stored as a JSON blob in a new `settings` table (`key TEXT PRIMARY KEY, value TEXT`). Presets can be applied to a run in one click from the Payments tab.

---

## 3. Calendar Page

**Route:** `/calendar` — added to nav bar alongside Runs and Players.

**Layout:**
- Month grid, one row per week (Mon–Sun)
- Days with a vball run show a highlighted chip with the run title (truncated if needed)
- Days without runs are plain
- Clicking a run chip navigates to `/runs/[id]`

**Navigation:** Prev/next month buttons, current month/year label. Defaults to current month.

**Data source:** Reuses existing `/api/runs` — no new API endpoint needed.

---

## 4. Player Profile Pages

**Route:** `/players/[id]` — player rows in the players list become clickable links.

### Header
- Display name shown large, editable inline (pencil icon → text input → save)
- Partiful name shown below as muted subtitle
- Running balance shown prominently: green for credit, red for owed, neutral for zero
- Player notes field (editable textarea, collapsed by default)

### Run history table
One row per run the player attended (GOING only). Columns:
- Date
- Run title (links to `/runs/[id]`)
- Amount owed
- Amount paid (editable inline)
- Status badge: Paid / Partial / Unpaid
- Mark Paid toggle (records `amountPaid = amountOwed` if no custom amount entered)

### APIs
- `GET /api/players/[id]` — player info + all attendance rows with payment data + computed balance
- `PATCH /api/players/[id]` — update `displayName` and/or `notes`

---

## 5. Dashboard Balance Summary

Top of the homepage (`/`), above the Upcoming/Past run lists:

- Total outstanding balance across all players (sum of all negative balances)
- Count of players who owe more than $0
- Small "needs follow-up" section: list of players with balance below –$10 (hardcoded threshold)

Data from `/api/players` which already computes `totalOwing`.

---

## 6. Guest Quick-Add

On the run detail page, a "Add Guest" button opens a small form:
- Name input (freetext)
- This creates a player record with a generated `userId` (prefixed `manual-`) and adds a GOING attendance row for that run
- Manual players are visually distinguished (e.g. a small tag) and are not overwritten by Partiful sync

---

## 7. Waitlist View

If Partiful returns a `WAITLIST` RSVP status, surface it as a separate section on the run detail guest list below Going/Maybe. No payment records for waitlisted guests. Sync route already stores raw `rsvpStatus` — this is a display-only change.

---

## 8. Run Notes

Freetext `notes` field on each run (stored in `runs.notes`). Shown on the run detail page below the title, editable inline. Useful for "gym closed early", "only 10 showed up", etc. Saved via existing `PATCH /api/runs/[id]`.

---

## 9. Payment Reminder Copy

On the player profile page, a "Copy reminder" button generates a message like:

> "Hey [displayName], you owe $X from [N] runs. Venmo/e-transfer whenever!"

Copies to clipboard. No sending — just copy-paste into WhatsApp/iMessage. The message template is hardcoded (no configurability needed).

---

## 10. Player Notes

Freetext `notes` field on each player profile (stored in `players.notes`). Editable textarea on the profile page. Visible only to you (local app). Examples: "Venmos immediately", "usually pays cash", "tends to cancel last minute".

---

## 11. Attendance Streaks

On the player profile page, show:
- Current streak: consecutive runs attended (ending at most recent run)
- Best streak: longest run of consecutive attendance

Computed from the run history table. Display only — no scoring. Uses `attendance` rows with `rsvpStatus = 'GOING'` ordered by `startDate`.

---

## Navigation Changes

Add **Calendar** to the nav bar:

```
🏐 VBall Tracker   Runs   Calendar   Players
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/lib/db.ts` | ALTER TABLE migrations, new queries, updated interfaces |
| `src/app/layout.tsx` | Add Calendar nav link |
| `src/app/page.tsx` | Add balance summary section |
| `src/app/calendar/page.tsx` | New — calendar view |
| `src/app/players/page.tsx` | Add balance column, clickable rows |
| `src/app/players/[id]/page.tsx` | New — player profile |
| `src/app/api/players/route.ts` | Update balance query |
| `src/app/api/players/[id]/route.ts` | New — player detail + PATCH |
| `src/app/api/runs/[id]/route.ts` | Return costPerHead computed, include notes |
| `src/app/api/runs/[id]/sync/route.ts` | Default cost from last run, GOING-only payments |
| `src/app/api/runs/[id]/payments/route.ts` | Store amountPaid, handle custom amounts |
| `src/app/api/settings/route.ts` | New — GET/POST cost presets from settings table |
| `src/app/runs/[id]/page.tsx` | totalCost/splitCount inputs, notes field, preset picker, quick-add |
