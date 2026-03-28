# VBall Tracker

Self-hosted Next.js web app for managing volleyball private runs. Syncs guest lists from Partiful, tracks attendance and payments, shows player history.

## Stack

- **Next.js 14** App Router, TypeScript, Tailwind CSS + shadcn/ui
- **SQLite** via `better-sqlite3` — local persistence at `$DATA_DIR/vball.db`
- **Docker** multi-stage build (`node:22-alpine`), deployed on home server via Tailscale

## Project Structure

```
src/
  app/
    page.tsx                    # Dashboard: upcoming/past runs
    players/page.tsx            # Player history + stats table
    runs/[id]/page.tsx          # Run detail: guests, attendance, payments
    api/
      runs/route.ts             # GET upcoming+past from Partiful
      runs/[id]/route.ts        # GET run+guests, PATCH run metadata
      runs/[id]/sync/route.ts   # POST sync guests from Partiful/Firestore
      runs/[id]/attendance/     # POST toggle attendance
      runs/[id]/payments/       # POST upsert payment
      players/route.ts          # GET player stats
  lib/
    auth.ts       # Firebase token refresh (PARTIFUL_REFRESH_TOKEN → id_token, cached)
    partiful.ts   # Partiful REST + Firestore client
    firestore.ts  # Firestore value deserializer + Guest interface
    db.ts         # SQLite schema init + prepared queries
    utils.ts      # shadcn cn() utility
```

## Environment Variables

```
PARTIFUL_REFRESH_TOKEN=   # Firebase refresh token for Partiful auth
FIREBASE_API_KEY=         # Firebase API key (AIzaSy...)
DATA_DIR=./data           # Directory for vball.db (use /data in Docker)
```

`.env` is gitignored. See `.env.example`.

## Key Technical Details

- **Partiful API**: `https://api.partiful.com/` — POST endpoints, Bearer token auth
- **Firestore REST**: `https://firestore.googleapis.com/v1/projects/getpartiful/databases/(default)/documents`
- **Firebase token refresh**: `securetoken.googleapis.com/v1/token` with refresh token
- **Firebase project**: `getpartiful`, App ID: `1:939741910890:web:5cca435c4b26209b8a7713`
- **Kevin's Partiful userId**: `uFItaBptDMVmeXFHhw1Rhma8FOq1`
- **Test event (vball)**: `fZze0vVmmgdXh55ovvsU` ("WE (V)BALL 🏐🏐🏐")

## Database Schema

Tables: `players`, `runs`, `attendance`, `payments` — see `src/lib/db.ts`.
All prepared queries are on `queries` export from `db.ts`.

## Dev Commands

```bash
npm run dev                                    # Start dev server (localhost:3000)
npm run build                                  # Production build (TypeScript check)
npx tsx src/lib/test-partiful.ts <eventId>    # Test Partiful API
docker compose up --build                      # Build + run in Docker
```

## Coding Conventions

- API routes: Next.js App Router format, `NextResponse.json()`
- All pages are `'use client'` (data fetched from API routes)
- shadcn/ui components live in `src/components/ui/`
- Tailwind v3 + shadcn v4 (CSS variables via oklch)
- No `"type": "module"` in package.json (better-sqlite3 requires CJS)
- `next.config.js` uses `experimental.serverComponentsExternalPackages` for better-sqlite3 (Next.js 14 syntax)
