# Mobile Responsive Design Spec

**Date:** 2026-03-28
**Scope:** UI-only — Tailwind responsive classes, no backend or route changes
**Files:** `layout.tsx`, `page.tsx`, `runs/[id]/page.tsx`, `players/page.tsx`, `players/[id]/page.tsx`, `calendar/page.tsx`

---

## Goal

Make all pages usable on mobile phones. Primary use case: organizer checks guest list and toggles payments on-site at the volleyball run. No functionality changes — purely layout and responsiveness.

---

## Breakpoint Strategy

Use Tailwind's `sm` breakpoint (640px) as the mobile/desktop boundary throughout. Mobile-first: base styles are mobile, `sm:` overrides for desktop.

---

## Changes by File

### `src/app/layout.tsx`

- Main padding: `px-4 py-6` (mobile) → `sm:px-6 sm:py-8`
- Nav: `px-4` (mobile) → `sm:px-6`, add `flex-wrap gap-y-2` so logo + links wrap on very narrow screens

### `src/app/page.tsx` (Dashboard)

- Outstanding header row: add `flex-wrap gap-y-1` so amount and count wrap below heading on narrow screens
- `EventCard`: title+button row uses `flex items-start justify-between gap-2`; title gets `min-w-0 truncate` to prevent pushing the button off-screen

### `src/app/runs/[id]/page.tsx` (Run Detail)

- Header: `flex-col sm:flex-row` — sync button moves below title/notes on mobile
- Stat cards: already `grid-cols-2`, keep as-is (works at 320px+)
- `GuestRow`: stack to two rows on mobile — `flex-col sm:flex-row`, name+badge on top, button on bottom (`self-start`)
- `PaymentRow`: same stack pattern; custom amount input + buttons wrap below name/amount on mobile
- `CostSection` edit mode: `flex-wrap` so inputs + buttons wrap to next line
- Add-guest form: input already `flex-1`, add `min-w-0` to prevent overflow
- `NotesField`: textarea already `w-full`, no change needed

### `src/app/players/page.tsx` (Players List)

Replace table with responsive layout:
- **Mobile (`sm:hidden`)**: card stack — each player is a `<div>` with name on left, runs + balance on right, full row is a link
- **Desktop (`hidden sm:block`)**: existing `<table>` unchanged

### `src/app/players/[id]/page.tsx` (Player Profile)

- Profile header: `flex-col sm:flex-row` — balance block moves below name/notes on mobile
- Edit name: input gets `w-full sm:w-auto`
- Run history table: same dual-render pattern as players list
  - **Mobile**: card per run — title+date on top, owed/paid/status inline, action button below
  - **Desktop**: existing `<table>` unchanged

### `src/app/calendar/page.tsx` (Calendar)

- **Desktop (`hidden sm:block`)**: existing 7-col grid unchanged
- **Mobile (`sm:hidden`)**: list view — shows all runs in the current month sorted by date, each as a tappable card linking to the run. Prev/next/today nav preserved. Empty state: "No runs in [Month Year]."

---

## Touch Targets

- All `<Button>` components already have sufficient tap area via shadcn defaults (`h-9` / `h-8` for `size="sm"`)
- Small text-action links ("custom", "Save as preset"): wrap in `<button>` with `py-1 px-1` minimum — already the case, acceptable
- Calendar day cells on desktop: no change needed (desktop-only)

---

## What Does NOT Change

- All functionality, data fetching, API calls
- Desktop layout (all changes are additive mobile overrides)
- shadcn/ui component internals
- Any backend/API files
