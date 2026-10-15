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
messages. Login limits are 10 attempts per IP/email, 10 per email across IPs, and
30 per IP per 15 minutes; signup is 5 per IP per 15 minutes. Atomic PostgreSQL
AuthRateLimit counters survive restarts and are shared across instances using
the same database and NEXTAUTH_SECRET. Identifiers are HMAC-hashed; expired rows
are cleaned in bounded batches. Database failure denies login and returns 503
for signup; there is no in-memory fallback. Rotating NEXTAUTH_SECRET changes the
counter namespace as well as logging users out. These limits are not a network
DoS shield; use an ingress limit on an exposed host. Only set
TRUST_PROXY when your proxy overwrites forwarding headers; code also trusts the
Vercel environment flag. Without trusted headers clients share the unknown-IP
bucket (including the broad login limit). Prevent direct access around the proxy.
This does not imply serverless support for the application.

Middleware protects dashboard and settings pages. APIs enforce their own session and
ownership gates. User data must be scoped to userId; Desk ownership failures use
404. Admin broker, health and all YouTube routes, including summaries and channels,
use admin gates. Health failures return generic messages; details stay in server logs.
ADMIN_EMAILS is normalized case-insensitively. Role synchronization promotes
listed users and demotes removed admins on their next role synchronization, including
when the list is empty. The allowlist alone grants admin access; stored roles cannot
override it. An empty or missing list grants no admin access. To recover operator
access, restore the operator's email in ADMIN_EMAILS and restart the server. These
semantics are shared with private Insights.

Desk uses the same private eligibility/key resolver as Insights: admins use the
server OpenRouter key (503 if absent); other authenticated users require their
stored OpenRouter key (403 if absent). Admins do not fall back to a personal key.
The private bundle is trusted executable code and must preserve these contracts.

## Database and secrets

Stored ApiKey values use AES-256-GCM with a random 96-bit nonce and an authenticated
user/provider/key-version binding. The versioned encryption keyring lives in
API_KEY_ENCRYPTION_KEYS, separately from the database; the active write key is
API_KEY_ENCRYPTION_ACTIVE_KEY_ID. Runtime reads reject plaintext and malformed
envelopes. Settings responses select metadata only. Private Insights/Desk must
use readApiKey from lib/security/api-key-store.ts; never read ApiKey.apiKey directly.
Encryption protects a database-only leak, not a compromised app host. Historical
plaintext backups remain sensitive; rotate provider keys to invalidate old copies.
Back up the encryption keyring separately and retain old key versions while old
backups must remain recoverable. Without the keyring, stored keys cannot be recovered.
Restrict database credentials, backups and operator access accordingly. Prisma
uses separate restricted runtime and identity roles; domain queries use local
authenticated context and database-enforced ownership policies. Runtime connections
cannot bypass RLS or own tables. The identity connection can access only identities
and login counters. See [identity operations](docs/identity-hardening.md) for verified
migration application, role provisioning, rotation and deployment. `db push` does
not apply the SQL policies or grants. Application authorization remains essential.

Never commit `.env*` other than `.env.example`, Webull token caches under `conf/`,
`project_oracle_v.5/`, private Insights modules/prompts/skills, run artifacts or
backups. Ignore rules are not encryption. Restrict filesystem permissions for all
of these, keep private bundles outside the public repository, and inspect staged
files before publishing. Do not put keys into command arguments or logs.

The demo seed is off by default. Explicit SEED_DEMO_USER=true creates
`john@doe.com` / `johndoe123` for local development. Keep SEED_DEMO_USER=false on
an exposed instance and remove any existing demo account; that flag only
skips creation and does not delete it. Email verification and emailed password reset
are deferred. Account security provides authenticator MFA, one-use recovery codes,
password changes, sign-out-all and account deletion. Every authenticated request
validates the stored session version and disabled/deleted state. Old JWTs without
a version are rejected. In-flight provider requests and already delivered data
cannot be retracted.

## Processes, providers and remaining limits

Custom POST/PUT/PATCH/DELETE route handlers require an exact Origin matching
NEXTAUTH_URL plus X-CSRF-Token matching NextAuth v4's signed double-submit cookie.
The guard runs inside each route, independently of page middleware. NextAuth's
own endpoints retain its built-in protection. Browser callers use apiFetch;
operator HTTP clients must obtain /api/auth/csrf, retain its cookie, and send
Origin and X-CSRF-Token along with their authenticated session. HTTPS uses the
host-prefixed CSRF cookie. There is no missing-Origin bypass. Recheck the cookie
format when upgrading NextAuth. Request protection does not replace authorization.

Page middleware generates a new CSP nonce and passes it to Next's framework scripts
and next-themes. HTML responses are private/no-store. CSP defaults to report-only:
violations appear in browser developer tools and are not centrally collected.
Set CSP_ENFORCE=true only after browser acceptance. Script unsafe-inline is absent;
unsafe-eval is development-only. Inline styles remain allowed for the chart/UI
libraries. Next/font assets are local; YouTube thumbnails allow i.ytimg.com.
The current policy allows no frames. This is a rollout policy, not an XSS guarantee.

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
permissions headers alongside the CSP rollout above; these are not a complete security audit.

For a suspected vulnerability, contact the deployment operator privately. Do not
post credentials, private research code or user data in public GitHub issues.
