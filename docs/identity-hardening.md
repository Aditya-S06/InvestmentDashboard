# Identity and database operations

The application keeps NextAuth credentials login. Account security is available
from Settings → Account security or `/dashboard/security`. Authenticator MFA is
opt-in: add the displayed setup key to an authenticator app, confirm a fresh
six-digit code, and save the ten one-use recovery codes. Codes are shown once.
MFA secrets use the same versioned authenticated encryption/keyring as API keys;
only hashes of the 128-bit recovery codes are stored. Enrollment expires after
ten minutes. TOTP accepts one adjacent 30-second step for clock drift and rejects
reuse, including concurrent attempts. After using a code, wait for the next one.

Password changes, MFA changes, and sign-out-all increment the account's session
version. Each authenticated request checks the current identity record. Existing
JWTs without a version are invalid after this deployment. Changes cannot retract
an already delivered response or stop an external provider request already sent.
Email verification and emailed password reset are intentionally deferred; there
is no mail provider configuration or public reset endpoint. Recovery codes replace
the second factor, **not the password**. Loss of both factors, or of the password,
requires the deployment operator to verify identity and recover the account offline.

Deletion requires password, second factor when enabled, and the literal `DELETE`.
It refuses queued/running Desk jobs and unresolved broker orders. The account is
disabled and its sessions revoked before removing local Desk artifacts and the
identity row; foreign keys cascade the user's app data. If disk cleanup fails,
the disabled identity remains for operator cleanup. Deletion cannot erase
external brokerage/provider records or retained backups. Shared YouTube summaries
are instance-owned and are not deleted with an account. Use the configured
`DESK_DATA_ROOT` when investigating a failed cleanup; never blindly delete a path.

## Database credentials

`DATABASE_URL` must authenticate as `oracle_runtime`, a non-owner without bypass
or administrative privileges. Domain queries run inside transactions with local
user ID, session version, and admin context; RLS constrains both reads and writes,
including child relationships. The per-user transaction advisory lock serializes
deletion checks with new work reservations. Interactive Prisma transactions are
supported; array transactions and unscoped/unsafe operations are not exposed.
Background jobs must obtain an explicit authenticated context; no fallback to
an owner login is permitted. The current Desk supervisor does not connect to SQL.

`AUTH_DATABASE_URL` authenticates separately as `oracle_identity`. This role can
access only `User` and `AuthRateLimit`, supporting pre-login password/MFA checks
and shared rate limits. It intentionally has access to all identity records,
so auth code remains security-sensitive. Neither role may create schema objects
or inherit privileged roles. Startup query guards refuse a misconfigured role.
RLS protects against omitted ownership filters; it does not make a compromised
server or arbitrary SQL execution safe. The app sets trusted request context.

Privileged credentials belong in the ignored operator file `.env.migrations`,
not in the service environment. Runtime `DIRECT_URL` also uses the restricted
connection. Next.js does not load `.env.migrations` or `.env.runtime.pending`.
Restrict their filesystem permissions, store recovery copies securely, and keep
them out of deployment images and public backups. On a self-hosted machine,
separate OS identities/ACLs are required to deny the service process access to
operator files; merely using separate filenames is not that OS boundary.

## Applying and verifying

For an existing Supabase-ledger installation, initially supply operator connection
URLs in `.env` (or directly in `.env.migrations`), then run:

```powershell
npx prisma generate
npm run security:harden-db
npm run security:verify-identity
npm run security:activate-db
```

Provisioning preserves the operator URLs in `.env.migrations`, applies the Desk
shared limiter and identity migrations if missing, creates random passwords for the restricted
roles, and writes candidate URLs to `.env.runtime.pending`. Verification uses
temporary synthetic accounts and cleans them up. Activation tests the role logins
and updates `.env`. Restart/redeploy every application instance with those URLs.
Provisioning reuses saved candidate credentials on reruns; do not remove the
pending file and rerun against a running service unless rotating its passwords.

For a fresh Prisma-managed database, `npm run setup` applies **all** migrations
with operator credentials, provisions and verifies restricted logins, and activates
the URLs. It creates missing Supabase-style `anon` and `authenticated` roles on
plain local Postgres. Existing schema-push databases require a reviewed baseline.
Do not use `db push` as a substitute: it omits SQL policies, grants and roles.
Do not introduce a second migration ledger into an existing Supabase deployment.

Maintenance scripts can explicitly preload `scripts/operator-env.cjs` to load
`.env` then override only database URLs from `.env.migrations`. Never preload this
file in `next dev`, `next start`, or other service processes. For example:

```powershell
npx tsx --require ./scripts/operator-env.cjs scripts/verify-security-db.ts
npm run security:encrypt-keys -- --apply
```

The encryption command rotates both API-key envelopes and MFA secrets. Retain
old keyring entries until all live rows are re-encrypted and older backups no
longer need them. Back up the keyring separately from the database.

Production smoke checks use `.next/security-check` and loopback ports 3101/3102:
`node scripts/security-http-smoke.cjs` and
`npx tsx scripts/identity-http-smoke.ts`. The identity test creates and deletes a
synthetic account, performs no provider/broker requests, and requires the operator
file for fixture setup/cleanup. Neither script restarts the actual service.

The live project migration ledger and real restricted-role behavior were checked
during this change. Supabase's security advisor reported only the three unused
NextAuth adapter tables (`Account`, `Session`, `VerificationToken`) with RLS and
no policies: these are intentionally inaccessible. See the
[advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
