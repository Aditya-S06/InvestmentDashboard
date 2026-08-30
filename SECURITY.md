# Security notes

Personal portfolio desk. This is not a formal audit, SOC 2, or “bank-grade” claim. Strangers who can reach a deployed Next.js process should be assumed able to hit login, signup (when enabled), and the public auth routes.

## What is in place

- **Passwords** are stored with bcrypt (cost 12). Login compares hashes in `lib/auth.ts` (unknown emails still run `bcrypt.compare` against a dummy hash). Signup hashes before insert (`app/api/signup/route.ts`).
- **Sessions** are NextAuth JWT cookies. The session token is HttpOnly, `SameSite=lax` (same-site credentials POST from `/login`; Strict is not used because it can drop the cookie on that sign-in navigation), `Secure` when `NEXTAUTH_URL` is `https://` or when `NODE_ENV=production` except `http://localhost` / `127.0.0.1`. Production refuses a missing or placeholder `NEXTAUTH_SECRET` (skipped during `next build`).
- **Signup** is gated by `ALLOW_PUBLIC_SIGNUP` (default false). Duplicate emails do not return a distinct “already exists” 409; create either returns 201 or the same generic failure as other insert errors. If you ever enable public signup, create the `ADMIN_EMAILS` user out of band first so a stranger cannot register that address and inherit admin.
- **Rate limits** on `authorize()` (login) and `POST /api/signup` are in-memory maps in this Node process (`lib/auth/rate-limit.ts`). They do **not** coordinate across multiple instances or serverless replicas. The map is capped. Client `X-Forwarded-For` is ignored unless `TRUST_PROXY=true` or the process is on Vercel (which overwrites that header). Without a trusted proxy, IP is `unknown` (per-email / global buckets only; no per-IP ceiling, so a spoofed header cannot bypass or DoS-lock the whole login). Login over-limit looks like a failed credential check (`null`); signup over-limit returns 429.
- **Authorization:** dashboard APIs for watchlist, paper, and journal use `requireUser` and filter by `userId`. Broker, health, and YouTube ingest/poll use `requireAdmin` / `requireBrokerAdmin`. `/api/health` is admin-only.
- **RLS:** Postgres RLS is enabled and PostgREST `anon` / `authenticated` privileges are revoked on user tables. Journal/broker tables also use `FORCE ROW LEVEL SECURITY`. The Prisma role typically still has `BYPASSRLS` (Supabase `postgres`); app authorization is the session + `userId` filter, not RLS. FORCE is for a future owner without bypass.
- **HTTP headers** in `next.config.js`: `X-Frame-Options: DENY`, `nosniff`, referrer policy, empty permissions policy. No `Access-Control-Allow-Origin: *`. Production browser source maps are off.
- **Secrets** belong in `.env` (gitignored) or host env. `.env.example` uses placeholders, not a real Supabase project ref.

## Before a public deploy

- Set `NEXTAUTH_SECRET` to a long random value (not the example placeholder).
- Set `SEED_DEMO_USER=false` and do not leave `john@doe.com` / `johndoe123` on a reachable instance. Change or delete that user if it was already seeded.
- Keep `ALLOW_PUBLIC_SIGNUP=false` unless you intend open registration.
- If you terminate TLS at a reverse proxy, set `TRUST_PROXY=true` only when that proxy **overwrites** `X-Forwarded-For`.
- Do not commit `.env`, `conf/` token files, or `project_oracle_v.5/`.

## Explicitly out of scope

- Live Webull trading and expanding the broker surface.
- Multi-instance / Redis rate limiting.
- Hashing rows in the `ApiKey` table (values are stored in plaintext today).
- Password reset, email verification, OAuth, account-deletion API.
- CSP rewrite, public unauthenticated `/api/health`.
- Formal legal review (plain-language /privacy and /terms exist; they are not legal advice).
- Formal penetration test or compliance certification.
