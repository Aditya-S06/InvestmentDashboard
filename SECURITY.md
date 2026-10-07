# Security and operator responsibilities

This is a self-hosted personal project, not a formally audited service. The
controls below describe the source code; they do not certify a deployed host or
database. See README for private provisioning and setup prerequisites.

## Accounts and authorization

Credentials sign-in checks bcrypt password hashes and uses NextAuth JWT sessions.
Session cookies are HttpOnly, SameSite=Lax and Secure in production or with an
HTTPS app URL. Runtime production startup rejects a missing, short (under 16
characters), or known placeholder NEXTAUTH_SECRET; the production build phase
skips that guard. Use a long random secret and HTTPS.

Public signup defaults off (ALLOW_PUBLIC_SIGNUP=false). Enabled signup requires
at least 12 password characters, hashes at cost 12 and returns generic failure
messages. Login limits are 10 attempts per IP/email and 30 per IP per 15 minutes;
signup is 5 per IP per 15 minutes. Counters are bounded, in memory, per process,
and reset on restart. They are not distributed abuse protection. Only set
TRUST_PROXY when your proxy overwrites forwarding headers; code also trusts the
Vercel environment flag. Without trusted headers clients share the unknown-IP
bucket. This does not imply serverless support for the application.

Middleware protects dashboard and settings pages. APIs enforce their own session and
ownership gates. User data must be scoped to userId; Desk ownership failures use
404. Admin broker, health and YouTube ingest/poll routes use admin gates.
ADMIN_EMAILS is normalized case-insensitively. Role synchronization promotes
listed users and demotes removed admins only when the configured list is nonempty.
An empty list preserves existing database roles; removing the last address does
not revoke a stored admin role. These semantics are shared with private Insights.

Desk uses the same private eligibility/key resolver as Insights: admins use the
server OpenRouter key (503 if absent); other authenticated users require their
stored OpenRouter key (403 if absent). Admins do not fall back to a personal key.
The private bundle is trusted executable code and must preserve these contracts.

## Database and secrets

Stored ApiKey values are plaintext application data, not application-encrypted.
Restrict database credentials, backups and operator access accordingly. Prisma
uses privileged server credentials; application authorization remains essential.
Committed migrations enable RLS/revoke anon and authenticated access on app tables;
later journal/broker/Desk migrations also FORCE RLS. FORCE RLS subjects ordinary
table owners to policies; the configured runtime role must have the appropriate
privileges (a BYPASSRLS/superuser role bypasses RLS). These migrations are written
for a database with Supabase-style anon/authenticated roles. `db push` alone does
not apply their RLS/revoke SQL. Migration application and actual database grants
must be verified on the operator's target; they were not checked in desk-7.

Never commit `.env*` other than `.env.example`, Webull token caches under `conf/`,
`project_oracle_v.5/`, private Insights modules/prompts/skills, run artifacts or
backups. Ignore rules are not encryption. Restrict filesystem permissions for all
of these, keep private bundles outside the public repository, and inspect staged
files before publishing. Do not put keys into command arguments or logs.

The demo seed creates `john@doe.com` / `johndoe123`. Set SEED_DEMO_USER=false before
seeding a public instance and remove any existing demo account; that flag only
skips creation and does not delete it. No production account bootstrap, email
verification, password reset or account-deletion API is supplied.

## Processes, providers and remaining limits

Python children receive explicit environment allowlists; application dotenv
loading is blocked, including TradingAgents imports. Desk receives its resolved
OpenRouter key, supported model/tuning configuration, optional FRED key and scoped
paths. It does not receive database/auth/broker credentials. Proxy/certificate
runtime settings are allowed and may themselves contain sensitive information.
Use the parent process configuration described in README.

Desk needs a persistent host and private writable disk for results, logs, memory
and SQLite checkpoints. Its weighted limiter is per Node process, resets on
restart and is not shared between instances. Detached local Python supervision
owns sequencing and durable deadlines; scoped reads reconcile results after a
Next restart. Matching saved graph state is required for Resume; Clear coordinates
with queued/running/retiring ownership. Keep permanent lock files intact and follow
the reservation recovery procedure in README. These boundaries have Windows
offline fixture coverage, not native Linux, service-manager or browser acceptance.
Read coalescing is scoped to user/run for two seconds within one Node process;
it contains no credentials or report snapshots, resets on restart and never gates
cancellation. Auth and ownership checks remain on routes; terminal writes retain
their compare-and-swap guard. See README for stream freshness, demand-driven
replay and the launch-body 16-KiB / raw-analyst 16-entry limits (explicit 413/400
errors). These do not change provider budgets, depth-weighted charges, refunds,
checkpoint locking or shared-memory isolation. Export/retention/concurrency
policy still needs workload input; complete research is not silently truncated.
Restrict artifact access and retention; research output and logs can contain user data. Desk has no brokerage
execution integration. Its disclaimer is: “Simulated research desk. Not an order.
Not advice.”

The application separately contains Webull order APIs behind admin gates and
default-off WEBULL_TRADING_ENABLED / WEBULL_LIVE_TRADING_ENABLED flags. It is not
accurate to describe the entire broker subsystem as read-only. Keep both flags
off unless intentionally operating and reviewing that separate subsystem.

Provider requests disclose relevant research inputs to those providers (Yahoo,
OpenRouter, optional YouTube/FRED/Webull). Private Insights compatibility and live
providers were not exercised by setup tests. Next adds frame, MIME, referrer and
permissions headers; these are not a complete security audit or CSP policy.

For a suspected vulnerability, contact the deployment operator privately. Do not
post credentials, private research code or user data in public GitHub issues.
