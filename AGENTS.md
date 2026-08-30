# Investment Dashboard — agent brief

Self-hosted Next.js 14 market desk (watchlist, Yahoo via Python, optional admin Webull / Insights / YouTube). App root is the repo root. GitHub: https://github.com/Aditya-S06/InvestmentDashboard

## Install / run / test

Node 20+, Python 3.10+. From repo root:

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
```

Edit `.env`: set `NEXTAUTH_SECRET` to a long random string and fill `DATABASE_URL` / `DIRECT_URL` (or `npm run db:link`). Then:

```powershell
npx prisma generate
npx prisma db seed
npm run dev
```

http://localhost:3000 — `npm test` (Vitest: signup/login smoke + Webull order tests). Optional local Postgres: `npm run db:up` then `npm run setup` instead of Supabase.

Demo seed: `john@doe.com` / `johndoe123`. Before a public instance set `SEED_DEMO_USER=false`. Keep `ALLOW_PUBLIC_SIGNUP=false` unless you intend open registration. See [SECURITY.md](SECURITY.md).

## Env

Required: `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. Template: `.env.example`.

**Do not commit** `.env`, `conf/token.txt`, `project_oracle_v.5/`, or Insights harness (`lib/insights/harness/`).

## Authz

`middleware.ts` only matches `/dashboard/:path*`. APIs self-gate:

- User data (watchlist, paper, journal, session market reads): `requireUser` and filter by `userId`
- Admin (broker, health, YouTube ingest/poll): `requireAdmin` / `requireBrokerAdmin`

Do not add an API route without one of those. Exceptions: NextAuth `/api/auth/*` and gated `POST /api/signup`.

## Copy

Use “indicator / signal / suggests”. Do not use “prediction”, “guaranteed”, or investment-advice claims.

## Prisma

Run `npx prisma generate` after schema changes.
