# Cancelled Runs + Auto Attendee Split

**Date:** 2026-08-05
**Status:** Approved

## Problem

Two related gaps in run cost handling:

1. **Cancelled runs.** When a Partiful event is cancelled, the run stays in the app and
   keeps charging every GOING guest their share. Runs must not be deleted (history and
   already-recorded payments matter), but they must stop generating new charges and be
   visibly marked as cancelled.

2. **Stale split count.** `POST /api/runs/[id]/sync` computes each attendee's share as
   `totalCost / splitCount`, where `splitCount` is a fixed manual number (default 12,
   or whatever the last run used). It ignores how many people actually RSVP'd GOING, so
   the per-head amount is wrong whenever turnout differs from 12.

## Design

### 1. Cancellation reuses `isHosting`

No new schema. The existing `runs.isHosting` column (added by the "not hosting" toggle)
already means exactly what cancellation needs: this run does not generate charges and is
excluded from financial tracking.

`isHosting = 0` on a run already causes:

- Dashboard (`src/app/page.tsx`) hides it, behind an existing "show N hidden runs" toggle
- `getPlayerStats`, `getPlayerProfile`, `getPlayerAttendanceHistory`,
  `getUnpaidRunsForReconcile`, `getUnpaidPlusOnesForReconcile`, `getPlusOnesForPlayer`
  all filter it out (`AND (r.isHosting IS NULL OR r.isHosting = 1)`)
- Run detail page shows a "Not hosting" state and hides the cost/payment UI

The run row, its attendance, and any payments already recorded remain in the database
untouched.

### 2. Auto-detect cancellation from Partiful

In `GET /api/runs`, which already reads `event.status` for every Partiful event:

- If `/cancel/i` matches the event's `status`, and the local run's `isHosting` is not
  already `0`, write `isHosting = 0` via `queries.updateRunHosting`.
- **One-way only.** Never auto-flip `isHosting` back to `1`. A run marked not-hosting for
  non-cancellation reasons must not be silently re-enabled.

Partiful's cancelled status string is **`CANCELED`** (one L, American spelling), confirmed
against live data on 2026-08-05: across all of Kevin's events the only two distinct status
values are `PUBLISHED` and `CANCELED`. The match is kept as a case-insensitive substring on
`cancel` rather than an exact equality check so a spelling or prefix change on Partiful's
side (`CANCELLED`, `EVENT_CANCELED`) does not silently break detection. If Partiful ever
switches to something that does not contain "cancel", auto-detect quietly does nothing and
the manual toggle remains the fallback — which is why the manual override is mandatory,
not optional.

Auto-detect only runs for a run that already exists locally (has been synced at least
once). An event cancelled before it was ever synced has no local row to flip and no
payments to suppress, so nothing is needed.

### 3. Manual override (no change)

The existing "🏠 Hosting" / "Not hosting" toggle on the run detail page writes `isHosting`
through `PATCH /api/runs/[id]`. It already serves as the manual cancel/uncancel control.

### 4. Sync does not charge cancelled runs

In `POST /api/runs/[id]/sync`, when `run.isHosting === 0`:

- Still upsert players and attendance, so the guest list stays current
- Skip `upsertPaymentOwed` for guests and +1s — no new amounts owed
- Skip the host auto-pay and the prior-balance auto-credit passes

Payments recorded before the run was cancelled are left alone. Deciding whether to refund
them is a manual call, not something sync should guess at.

### 5. Split count follows actual attendance

In `POST /api/runs/[id]/sync`, for runs where `isHosting !== 0`:

- Compute `attendeeCount` = sum of `guest.count` over all GOING guests. `guest.count` is
  Partiful's headcount including the guest themselves, so this already covers +1s.
- If `attendeeCount > 0`, persist it as the run's `splitCount` and use it to derive
  `amountOwed = totalCost / attendeeCount`.
- If `attendeeCount === 0` (nobody GOING yet), leave the stored `splitCount` alone and
  charge nothing — dividing by zero is not a cost.

**Auto always wins.** A manually entered split count is overwritten by the next sync. The
cost form's split field is relabelled to say it is auto-updated on sync, so the behaviour
is visible rather than surprising.

Amounts are recomputed on every sync, so an attendee's owed amount changes as the roster
changes. Amounts already marked paid are not disturbed by this — `upsertPaymentOwed`
writes only the `amount` column and leaves `amountPaid` untouched.

## Files Changed

| File | Change |
|---|---|
| `src/app/api/runs/route.ts` | Detect cancelled status, flip `isHosting` to 0 |
| `src/app/api/runs/[id]/sync/route.ts` | Skip charges when cancelled; derive `splitCount` from GOING headcount |
| `src/app/runs/[id]/page.tsx` | Cancelled banner, relabelled toggle, split-count hint |
| `src/app/page.tsx` | Dashboard toggle label mentions cancelled |
| `src/lib/db.ts` | Prior-balance queries exclude non-hosted runs |

### Why the balance queries changed

`getPlayerBalanceExcludingRun` and `getPlayerBalancesExcludingRun` drive the auto-credit
pass — they sum a player's paid-minus-owed across every *other* run. Unlike every other
financial query in `db.ts`, they did not filter on `isHosting`. A cancelled run's leftover
unpaid `amount` rows would therefore drag a player's prior balance down and wrongly
suppress auto-credit on unrelated runs. Both now join `runs` and apply the same
`isHosting IS NULL OR isHosting = 1` filter used elsewhere. This keeps cancelled rows in
the database (so un-cancelling restores prior state) while making them financially
invisible.

## Out of Scope

- Refunding or clearing payments already recorded on a run that later gets cancelled
- A cancellation reason or timestamp
- Distinguishing "cancelled by host" from "I'm attending but not organizing" — both are
  `isHosting = 0`
