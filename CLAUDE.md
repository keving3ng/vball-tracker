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
    utils.ts      # cn() utility + ETRANSFER_EMAIL constant
```

## Environment Variables

```
PARTIFUL_REFRESH_TOKEN=   # Firebase refresh token for Partiful auth
FIREBASE_API_KEY=         # Firebase API key (AIzaSy...)
DATA_DIR=./data           # Directory for vball.db (use /data in Docker)
GOOGLE_GMAIL_CLIENT_ID=   # Google OAuth web-client ID for e-Transfer mailbox
GOOGLE_GMAIL_CLIENT_SECRET=
GOOGLE_GMAIL_REDIRECT_URI= # https://<stable-app-url>/api/gmail/callback
GMAIL_TOKEN_ENCRYPTION_KEY= # base64-encoded 32-byte AES key
GMAIL_ETRANSFER_LABEL=Vball Payments
GMAIL_SYNC_SECRET=        # secret sent by the home-server cron job
```

## Gmail e-Transfer reconciliation

The Reconcile page can import Interac receipt emails without Tangerine credentials or Plaid. In Google Cloud, enable the Gmail API and create a Web application OAuth client whose redirect URI is `${GOOGLE_GMAIL_REDIRECT_URI}`. Add the mailbox as a test user if the consent screen is in testing mode.

Create a Gmail filter that recognizes legitimate Interac e-Transfer receipt mail and applies the `Vball Payments` label (or the label in `GMAIL_ETRANSFER_LABEL`). The app requests `gmail.readonly` and only imports messages carrying that label; it never creates or edits Gmail filters. It additionally verifies that imported messages are from an `interac.ca` address and have an Interac e-Transfer subject.

After connecting Gmail on `/reconcile`, the app backfills from the earliest dated run in SQLite. Add a host cron job to import future mail every 10 minutes:

```cron
*/10 * * * * curl -fsS -X POST -H 'x-gmail-sync-secret: <GMAIL_SYNC_SECRET>' http://127.0.0.1:3000/api/gmail/sync >/dev/null
```

The cron endpoint only imports receipts; it never marks payments paid. Every payment allocation remains in the Reconcile review queue until approved.

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
- **Event filtering**: `/api/runs` requires BOTH a title match on `/vball|volley|🏐/i` AND `ownerIds` containing Kevin's Partiful userId. Title alone matches volleyball events Kevin was merely invited to, which don't belong in the app.
- **Partiful event status**: only two values observed in live data — `PUBLISHED` and `CANCELED` (one L). `/api/runs` auto-marks `CANCELED` events as `isHosting = 0`. Detection is one-way: it never flips a run back to hosting, since not-hosting is also set manually.
- **Cancelled runs = `isHosting = 0`**: there is no separate cancelled column. A run with `isHosting = 0` keeps its guest list and recorded payments but generates no new charges and is excluded from every financial query. Any new query that sums money MUST filter `(r.isHosting IS NULL OR r.isHosting = 1)` — missing it silently counts cancelled runs against player balances.
- **Split count is derived, not configured**: `POST /api/runs/[id]/sync` overwrites `runs.splitCount` with the actual GOING headcount (`sum of guest.count`, which already includes +1s). Manual edits to the split field are overwritten on the next sync.
- **Run display titles**: Any SQL query returning run titles must select both `r.title` AND `r.displayTitle`. Resolved name is `r.displayTitle ?? r.title` in JS (or `COALESCE(r.displayTitle, r.title)` in SQL). Missing `r.displayTitle` silently shows the Partiful title instead of the custom one.

## Database Schema

Tables: `players`, `runs`, `attendance`, `payments` — see `src/lib/db.ts`.
All prepared queries are on `queries` export from `db.ts`.

## Deploy Pipeline

**Keg is the sole deployment authority** (`keg.json` holds the build allowlist). The legacy GitHub Actions deploy (`.github/workflows/deploy.yml`) is retired and disabled; pushing to `main` does NOT deploy.

```bash
export WORKBENCH_TASK_ID=<ticket> KEG_AGENT=<unique-agent-name>
~/code/jonas-config/scripts/keg context
~/code/jonas-config/scripts/keg inspect
~/code/jonas-config/scripts/keg deploy      # see jonas-config/services/keg-config/README.md for build/plan/deploy flow
```

Read `~/code/jonas-config/docs/KEG-WORKBENCH-CONTRACT.md` first. Do not hand-roll `docker run` over SSH.

**Runtime (owned by Keg):**
- Port `3000`, health check `GET /`, route `https://vball.keglab.dev`
- Data: `/mnt/user/appdata/vball-tracker:/data` (SQLite `vball.db` + WAL). Cutover requires stopping the old writer, `PRAGMA wal_checkpoint(TRUNCATE)`, and a verified quiescent backup first. Never point a new empty volume at the service.
- Env: `/mnt/user/appdata/vball-tracker/.env` (secrets by name: PARTIFUL_REFRESH_TOKEN, FIREBASE_API_KEY, DATA_DIR=/data, Gmail OAuth) — managed on the host, never committed.
- `@keg/partiful-api` comes from private Verdaccio; the lockfile must resolve it for the Keg build (never commit `.npmrc`).

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
- Named constants: `DEFAULT_SPLIT_COUNT` exported from `db.ts` (default split = 12); `ETRANSFER_EMAIL` exported from `utils.ts`. Use these instead of hardcoding.
- Batch balance lookup: use `queries.getPlayerBalancesExcludingRun` (all users, build a Map) inside loops — not `queries.getPlayerBalanceExcludingRun` (single user) which causes N+1.
