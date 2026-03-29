# VBall Tracker

Self-hosted Next.js web app for managing volleyball private runs. Syncs guest lists from Partiful, tracks payments, shows player history. Attendance is not tracked — GOING RSVPs are assumed to have attended.

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
    runs/[id]/page.tsx          # Run detail: guests, payments
    api/
      runs/route.ts             # GET upcoming+past from Partiful (filtered to vball events)
      runs/[id]/route.ts        # GET run+guests, PATCH run metadata
      runs/[id]/sync/route.ts   # POST sync guests from Partiful/Firestore
      runs/[id]/payments/       # POST upsert payment
      players/route.ts          # GET player stats
  lib/
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

## External Packages

- **`@keg/partiful-api`** — Partiful REST + Firestore client, auth, types. Published to Verdaccio (private npm registry on Jonas at port 4873). Imported as `@keg/partiful-api` everywhere. `transpilePackages: ['@keg/partiful-api']` in next.config.js. Source at `keving3ng/partiful-api`. To request changes, create an issue tagged `@claude`.
- **Local dev note**: `@keg/partiful-api` resolves from Verdaccio (requires Tailscale). `npx tsc --noEmit` will fail locally without VPN — this is expected. CI has Tailscale access and will succeed.

## Gotchas

- **Next.js fetch caching**: All `fetch` calls in server-side code must include `cache: 'no-store'` — Next.js 14 caches POSTs by default, causing stale Firebase tokens → 401s from Partiful.
- **Next.js static generation of API routes**: App Router statically generates API routes with no dynamic segments at build time (actually calls the handler). Any route that hits an external API or DB must have `export const dynamic = 'force-dynamic'` at the top, otherwise `next build` will call it and fail without runtime env vars.
- **DB location**: `data/vball.db` (gitignored). `DATA_DIR=./data` locally, `/data` in Docker.
- **Event filtering**: `/api/runs` filters Partiful events to volleyball only via `/vball|volley|🏐/i`.

## Database Schema

Tables: `players`, `runs`, `attendance`, `payments` — see `src/lib/db.ts`.
All prepared queries are on `queries` export from `db.ts`.

## Deploy Pipeline

Push to `main` triggers GitHub Actions:
1. Joins Tailscale (ephemeral key, `tag:ci`)
2. Writes `.npmrc` pointing `@keg:registry` → `http://${TAILSCALE_IP}:4873` (Verdaccio) — **never commit .npmrc**, IP injected from secret
3. Configures Docker daemon + buildkitd for insecure Zot registry at `${TAILSCALE_IP}:5000`
4. Builds multi-stage Docker image, pushes to Zot as `vball-tracker:latest` + `vball-tracker:<sha>`
5. SSHes into Jonas → `docker stop/rm/run` (NOT restart)

**Jonas runtime:**
- Container: `vball-tracker`, port `3000:3000`
- Data: `/mnt/user/appdata/vball-tracker:/data` (SQLite lives here)
- Env: `/mnt/user/appdata/vball-tracker/.env` (PARTIFUL_REFRESH_TOKEN, FIREBASE_API_KEY, DATA_DIR=/data)

**First-time bootstrap:** `setup/vball-tracker.sh` — run after first CI push builds the image.

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
