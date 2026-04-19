# +1 Handling Design

**Date:** 2026-04-15  
**Status:** Approved

## Problem

Partiful `Guest.count` indicates how many people a guest is bringing (including themselves). Currently the app ignores `count` entirely — a guest bringing 2 +1s appears as a single entry with a single payment record, under-counting headcount and under-charging the host.

## Goals

- Each +1 gets its own payment record (separate from the host's)
- +1s are anonymous (no Partiful userId); they stay anonymous forever
- +1s are displayed nested under their host in the run detail page
- +1s are excluded from the players list and stats

## Non-Goals

- Naming / assigning a player to an anonymous +1 later
- Auto-adjusting `splitCount` on sync (organizer manages that manually)

## Schema Changes

Two additive `ALTER TABLE` migrations (safe for existing data):

```sql
ALTER TABLE attendance ADD COLUMN plus_one_of TEXT;
-- Nullable. When set, identifies the hostUserId this attendance row is a +1 of.

ALTER TABLE players ADD COLUMN is_anon_plus_one INTEGER DEFAULT 0;
-- Flag to exclude from player stats / players page. 1 for synthetic +1 records.
```

No existing rows are affected; new columns default to NULL / 0.

## Synthetic +1 Records

**userId format:** `{hostUserId}__plus1__{eventId}__{n}` (0-indexed)  
**name:** `"+1"`  
**is_anon_plus_one:** `1`

These are created / refreshed on every sync. On each sync for a given host+event:
1. Delete existing `attendance` rows where `plus_one_of = hostUserId AND event_id = eventId`
2. Delete their `payments` rows (cascade via eventId + userId)
3. Delete their `players` rows where `is_anon_plus_one = 1` and userId matches the pattern
4. Re-create based on current `guest.count - 1`

## Sync Route Changes (`/api/runs/[id]/sync`)

For each guest from Partiful:
1. Upsert main player + attendance + payment as today (unchanged)
2. If `guest.count > 1`:
   - Purge existing synthetic +1s for this host+event (steps above)
   - For `i` in `0..count-2`: create synthetic player, attendance (`plus_one_of = guest.userId`), and payment record

## API Changes (`/api/runs/[id]`)

Add `plusOneOf: string | null` to the guest response shape. The frontend uses this to group +1s under their host.

## UI Changes (run detail page)

**Guest list grouping:**
- Build a map: `hostUserId → [plusOneGuests]`
- Render host row, then immediately below render each +1 as an indented sub-row
- +1 sub-row shows: name "+1", payment status badge (same controls as regular guests)
- Host row shows a subtle count badge, e.g. `(+2)` when they have +1s

**Payment interaction:** unchanged — each +1 row has the same mark-paid / mark-unpaid controls as any other guest.

## Players Page

Exclude rows where `is_anon_plus_one = 1` from `getPlayerStats` query and the players list.

## Data Flow

```
Partiful: guest { userId, name, count: 3, status: GOING }

Sync:
  upsert player(hostId, "John")
  upsert attendance(hostId, eventId, GOING, plus_one_of=NULL)
  upsert payment(hostId, eventId)

  purge existing plus-ones for (hostId, eventId)

  for i in [0, 1]:
    upsert player("hostId__plus1__eventId__i", "+1", is_anon=1)
    upsert attendance("...", eventId, GOING, plus_one_of=hostId)
    upsert payment("...", eventId)

UI (run detail):
  John (Going)  [pay button]  (+2)
    └─ +1       [pay button]
    └─ +1       [pay button]
```

## Files to Change

| File | Change |
|------|--------|
| `src/lib/db.ts` | Schema migrations, new prepared queries for +1 purge + upsert |
| `src/app/api/runs/[id]/sync/route.ts` | Use `guest.count` to create synthetic +1 records |
| `src/app/api/runs/[id]/route.ts` | Include `plusOneOf` in guest response |
| `src/app/runs/[id]/page.tsx` | Group and render +1s nested under host |
