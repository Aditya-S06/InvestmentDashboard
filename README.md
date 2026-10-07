# Investment Dashboard

A self-hosted financial intelligence dashboard for tracking equities and building a personal watchlist. Built for investors who want a consolidated view of price action, sentiment signals, risk metrics, and macro context—without relying on a proprietary hosted platform.

Live market data is sourced from [Yahoo Finance](https://finance.yahoo.com/) via `yfinance`. Optional [Webull OpenAPI](https://developer.webull.com/) powers the admin broker panel, including separately gated order APIs with trading flags off by default. It is not used for dashboard pricing. User accounts, watchlists, paper trades, and settings are stored in **Supabase Postgres** (cloud). Docker Postgres is optional and no longer required.

## Features

- **Watchlist** — Starter mega-cap symbols (AAPL, MSFT, GOOGL, and peers) on first login; add or remove tickers and group them in the sidebar.
- **Ticker grid** — Real-time quotes, day change, sentiment bar, and risk badge for tracked symbols.
- **Detail modal** — Price history, RSI/MACD, analyst consensus, news with credibility tags, Kelly position sizing, and exit alerts.
- **Quant layer** (`/api/market/full`) — Pre-computed `quant_indicators`, `risk_metrics`, `predictive` forecast, and `strategy_signals` (regime, ATR sizing) from `scripts/market_data.py`; legacy `technicals` and `risk.score` unchanged. Includes `data_sources` (Yahoo for quotes/history).
- **Webull broker panel** (admin) — Accounts, positions, and balances, plus separately gated order APIs; trading flags default off. OpenAPI requires `WEBULL_APP_KEY` / `WEBULL_APP_SECRET`. Pricing stays on Yahoo.
- **Macro ribbon** — VIX, S&P 500, 10Y Treasury, Fed Funds, and US market open/closed status.
- **Ticker search** — Autocomplete and direct symbol entry.
- **Authentication** — Email/password sign-in with NextAuth.js; per-user watchlists persisted in the database.
- **Optional API keys** — Alpha Vantage and Polygon.io keys can be stored per user (settings modal).
- **YouTube Analysis** — Monitor financial YouTube channels, extract transcripts, generate structured LLM summaries, and query them from AI Insights via `get_youtube_channel_insights`. Browse results at `/dashboard/youtube-analysis`.

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, Tailwind CSS, Recharts |
| Backend | Next.js API routes, NextAuth.js v4 |
| Database | Supabase Postgres + Prisma ORM |
| Market data | Python 3, `yfinance`, `webull-openapi-python-sdk`, `pytz` |
| YouTube ingest | `google-api-python-client`, `youtube-transcript-api`, `yt-dlp`, OpenRouter |
| Optional local DB | Docker Compose (Postgres 16) — only if not using Supabase |

## Architecture

```
Browser → Next.js (dashboard, auth)  [runs on your machine or a host]
              ├── /api/market/*   →  Python (market_data.py)   →  Yahoo Finance
              ├── /api/broker/*   →  Python (webull_client.py)  →  Webull OpenAPI (admin)
              ├── /api/youtube/*  →  Python (youtube_ingest.py) →  YouTube Data API + OpenRouter
              ├── /api/paper/*    →  Prisma  →  Supabase Postgres
              ├── /api/watchlist/*  →  Prisma  →  Supabase Postgres
              └── /api/auth/*  →  NextAuth  →  Supabase Postgres
```

> Moving to Supabase replaces **local Docker Postgres**, not the Next.js/Python app. Market data still uses local Python. You can quit Docker Desktop after linking.

## Getting started

### Prerequisites and clean-checkout installation

Use Node 20+, Python 3.10+ and a persistent self-hosted machine. Run commands from
this repository root. Private Insights modules are required at compile/import time
even if you do not use Insights: obtain the matching operator-owned bundle below.
The public templates alone do **not** implement the research engine or key resolver.

Windows PowerShell:

```powershell
git clone --recurse-submodules https://github.com/Aditya-S06/InvestmentDashboard.git
cd InvestmentDashboard
# Also needed for a clone made without --recurse-submodules:
git submodule update --init --recursive
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
python -m venv TradingAgents/.venv
# Upstream requirements.txt contains '.', so install the local package explicitly:
.\TradingAgents\.venv\Scripts\python.exe -m pip install ./TradingAgents
node scripts/provision-private.mjs --from C:/private/oracle-bundle
node scripts/provision-private.mjs --check
Copy-Item .env.example .env
# Edit .env with your own database URLs, NEXTAUTH_SECRET and NEXTAUTH_URL.
npx prisma generate
# Only against the database you intentionally configured:
npx prisma migrate deploy
# Optional LOCAL demo account only (see SECURITY.md):
npm run db:seed
```

On Linux/macOS the equivalent Python commands are:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
python3 -m venv TradingAgents/.venv
TradingAgents/.venv/bin/python -m pip install ./TradingAgents
node scripts/provision-private.mjs --from /private/oracle-bundle
node scripts/provision-private.mjs --check
cp .env.example .env
```

Use the same npm/Prisma commands after configuring the environment. Do not replace
or re-clone TradingAgents: it is a Git submodule pinned by the superproject gitlink,
currently `be952b8eccb49720509af544c6675233bc1f10d0`. Verify with
`git ls-files -s TradingAgents` and `git -C TradingAgents rev-parse HEAD`.
Do not use `git submodule update --remote` during setup. App Python dependencies
live in `.venv`; Desk exclusively uses `TradingAgents/.venv` and imports the
pinned source via PYTHONPATH. Never substitute a fake tradingagents package.
Python dependency ranges are not fully locked: the source and Node lockfile are
pinned, but exact Python dependency resolution can change. Native Linux and a
fresh network dependency install still require verification.

For an existing database, review migration history/backups before applying SQL;
do not run initialization over a schema previously created with db push without
an operator-reviewed baseline. No setup verification script below migrates or
seeds a database. The optional db:link helper writes .env and connects to your
chosen database; it is not needed for offline checks.

### Private module provisioning (required)

A private bundle is an operator-maintained directory mirroring these exact paths:

- `lib/insights/{access,config,context-builder,orchestrator,tools,rate-limit}.ts`
- `lib/insights/harness/load-harness.ts`, `system.md`, `output.md`, and the complete original `skills/*.md` set
- `app/api/insights/access/route.ts` and `app/api/settings/apikeys/route.ts`

Obtain these from your authorized private source matching this app revision;
keep the bundle outside the public repository. Do not include .env, tokens,
credentials or run data. Provisioning copies only the listed files and flat
Markdown skills, preflights missing/empty files and unfinished template markers,
and refuses existing destinations and symlinks. It never overwrites an existing
installation. For upgrades, provision into a fresh release directory; preserve
and review the old private implementation separately. The --check command checks
presence and obvious unfinished templates, not correctness or authenticity.

The committed `*.example.ts` files describe interfaces for an operator who must
supply their own private implementation. Their TODOs, always-allow limiter and
placeholder research output are **not a runnable fallback**; do not bulk-copy them
into production. Access must retain the current eligibility/key contract, and
orchestrator/tools/context/harness/limits and private API routes must come from a
compatible implemented bundle. There is no automatic disabling of research or
change to access rights when modules are missing: imports/setup fail explicitly.

Bundle integration: private access.ts should import and re-export
`isInsightsAdmin` / `syncAdminRole` from `@/lib/auth/admin`, as shown in
access.example.ts. This shared module normalizes ADMIN_EMAILS, promotes listed
users, demotes removed admins only with a nonempty list, and preserves stored
roles when the list is empty. Keep private key resolution unchanged: admins use
the server key only; nonadmins use their stored OpenRouter key. Missing keys
remain 503 for admins and 403 for others. Desk re-exports this same access gate.

Tracked import inventory: `lib/desk/access.ts` and Insights sessions routes need
private access; chat needs access/config/rate-limit/orchestrator; brief needs
access/rate-limit/orchestrator. The access and settings clients also need the two
private HTTP routes above. The operator's research implementation needs the
context builder, tools, config, limiter and complete harness. `requireAdmin`
now depends only on committed `lib/auth/admin.ts`. No private implementation or
prompt is published by this setup path.

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Development seed account** (created by seed): `john@doe.com` / `johndoe123`  
Change or remove this user before any production deployment. Set `SEED_DEMO_USER=false` before seeding a public instance. Keep `ALLOW_PUBLIC_SIGNUP=false` unless you intend open registration. See [SECURITY.md](SECURITY.md).

### NPM scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run db:link` | Interactive helper to write Supabase URLs into `.env` |
| `npm run db:up` | Start optional local Postgres container |
| `npm run db:down` | Stop local Postgres container |
| `npm run db:push` | Apply Prisma schema (uses `DIRECT_URL`) |
| `npm run db:seed` | Seed demo user and starter watchlist |
| `npm run setup` | `prisma generate` + `db push` + `seed` |
| `npm test` | Run Vitest (signup/login smoke + Webull order tests) |

### Optional: local Docker Postgres

Only if you are **not** using Supabase:

```bash
npm run db:up
# On a fresh isolated vanilla Postgres only, create migration prerequisite roles:
docker exec market-intel-db psql -U postgres -d market_intel -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;"
npx prisma migrate deploy
npx prisma generate
# Optional local demo seed:
npm run db:seed
```

The role creation above is for a fresh local database; skip roles that already exist.
The Compose postgres superuser bypasses RLS. Production roles/grants need operator
review, especially FORCE RLS tables. `npm run setup` / `db:push` use schema push,
which does not execute migration RLS/revoke SQL. Do not treat them as migration deployment.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase **pooler** URL (port `6543`, `pgbouncer=true`) |
| `DIRECT_URL` | Yes | Supabase **session/direct** URL (port `5432`) for migrations/seed |
| `SUPABASE_URL` | Recommended | `https://<project-ref>.supabase.co` |
| `NEXTAUTH_SECRET` | Yes | Random secret for session signing (production refuses the example placeholder) |
| `NEXTAUTH_URL` | Yes | App URL (e.g. `http://localhost:3000`) |
| `TRUST_PROXY` | No | Set `true` only when a reverse proxy overwrites `X-Forwarded-For`. Vercel is trusted automatically. |
| `ALLOW_PUBLIC_SIGNUP` | No | Default `false`. Open registration is off unless set to `true`. |
| `SEED_DEMO_USER` | No | Set `false` before a public deploy so seed does not create the demo account. |
| `OPENROUTER_API_KEY` | For admin Insights / YouTube summaries | Server OpenRouter key |
| `ADMIN_EMAILS` | Recommended | Comma-separated admin emails |
| `YOUTUBE_API_KEY` | For YouTube Analysis | Google Cloud YouTube Data API v3 key |
| `YOUTUBE_CHANNELS_FILE` | Optional | Default `conf/youtube_channels.json` |
| `YOUTUBE_POLL_SINCE_DAYS` | Optional | Default `2` |
| `WEBULL_APP_KEY` | Optional | Webull OpenAPI app key (admin broker panel only) |
| `WEBULL_APP_SECRET` | Optional | Webull OpenAPI app secret |
| `WEBULL_REGION_ID` | Optional | Default `us` |
| `WEBULL_ENVIRONMENT` | Optional | `prod` or `uat` |
| `WEBULL_RATE_LIMIT_PER_MIN` | Optional | Default `30` |

See [`.env.example`](.env.example) for a template.

### Trading Desk configuration and hosting

Set Desk configuration in the Next parent process (root `.env` for Next, or your
service manager). TradingAgents `.env` and `.env.enterprise` are deliberately not
loaded by the app runner. Restart the parent to apply configuration changes.

- `OPENROUTER_BASE_URL`: default `https://openrouter.ai/api/v1`.
- `DESK_DEEP_MODEL`: code default `deepseek/deepseek-v4-pro`;
  `DESK_QUICK_MODEL`: code default `google/gemini-3.5-flash`. These are configured
  IDs, not a claim of current provider availability; select models your account supports.
- `DESK_DATA_ROOT`: parent-only path, default `<repo>/.data/desk`. Parent passes
  resolved results/cache/memory paths to Python. Results are `{root}/{userId}/{runId}`,
  memory `{root}/{userId}/trading_memory.md`, checkpoints
  `{root}/{userId}/cache/checkpoints/{TICKER}.db`. Keep this directory private,
  persistent, writable and backed up with appropriate retention.
- `DESK_RATE_LIMIT_PER_HOUR`: default 4 weighted units per user/hour per Node
  process; fast costs 1, standard 2, deep 3. Counters reset on restart and are not
  shared across instances. Per-ticker deadlines are 90/180/300 seconds respectively.
- Supported optional parent settings forwarded to the child:
  `TRADINGAGENTS_OUTPUT_LANGUAGE`, `TRADINGAGENTS_BENCHMARK_TICKER`,
  `TRADINGAGENTS_TEMPERATURE`, `TRADINGAGENTS_LLM_MAX_RETRIES`,
  `TRADINGAGENTS_MAX_TOKENS`, `FRED_API_KEY`. Other upstream environment settings
  are not automatically inherited. Checkpoint enablement comes from run input;
  paths, PYTHONPATH and the resolved per-run OpenRouter key come from the parent.

Use a long-running Node service started at the repository root, both Python
environments, the submodule, provisioned private files, persistent disk and
database connectivity. `npm run build` then `npm start` is the production command
sequence; configure HTTPS/reverse proxy separately. Do not assume standalone
Next output automatically packages Python, the submodule or private harness.
This setup does not support ephemeral/serverless execution.

The detached local Python supervisor owns sequential ticker advancement and
persisted deadlines. Scoped reads reconcile durable results after a Next restart;
disconnecting a stream does not cancel the run. The host/service manager must
allow the supervisor and its owned graph descendants to survive a Node restart.
Host/supervisor death is reported as interruption, without automatic graph replay.
Native Windows fixture processes are verified; actual service-manager restarts,
native Linux and browser workflows remain unverified.

Desk operating bounds: same-user/run reconciliation is coalesced within one Node
process with a **2-second freshness window measured from check start**. Detail
reads reconcile only that run. New processes start fresh; cancellation bypasses
and invalidates coalescing, and terminal DB writes remain guarded. Streams tail
local events every 400 ms while caught up, but check scoped ownership/status every
2 seconds. Combined scheduling can delay streamed terminal notification by up to
about 4 seconds plus helper/DB latency and consumer drain time. These are read
delays, never deadline extensions or cancellation leases. The 50-ms supervisor
loop retains its operation lock, checks cancellation every iteration and uses
state/receipt metadata to detect changes; transitions and keyless controls still
perform full durable recovery.

Replay advances only when the consumer pulls (no speculative frame queue), with
64-KiB file reads and an incomplete/current record retained until complete. No
persisted events or research are truncated. ZIP exports stream headers and full
curated entry buffers directly, avoiding per-entry and whole-archive copies;
report serialization still requires memory proportional to the report size.

Launch JSON is limited to **16,384 UTF-8 bytes**, counted from the actual body even
without or with misleading Content-Length; overflow returns **413** with the byte
limit. Invalid JSON returns **400**. Current form requests, including resume
references, fit well below 2 KiB; the 16-KiB allowance leaves substantial headroom
without accepting unlimited JSON. At most **16 raw analyst selections** are
accepted (400 with an explicit limit above that), allowing repeated choices while
bounding validation work. Valid selections are deduplicated in market/social/news/
fundamentals order; crypto still excludes fundamentals. These input limits do not
truncate research or change per-run depth-weighted charges or refund behavior.

Export-byte ceilings, automated retention and concurrency policy remain deferred
pending representative workload/storage measurements and operator requirements.
No global run cap, distributed limiter, Redis or hosted queue is introduced.
The synthetic offline call/read measurements in TauricPlan.md demonstrate local
efficiency changes; they do not establish production saturation or capacity.

Resume requires matching pending SQLite graph state and saved settings, not file
existence. It restores one ticker's settings and resolves a fresh authenticated
key. Clear refuses queued, running or retiring ownership. Keep operation/use/owner
lock files in place; drain older runners before upgrading. A launch interrupted
before manifest publication can leave a reservation blocking that ticker. An
operator must stop relevant processes, reconcile the scoped DB state and verify
quiescence before removing that specific reservation JSON; never delete lock files
or guess process ownership. Storage is local to one persistent host; distributed
storage and multi-host coordination are unsupported. No Desk brokerage integration
is supplied. “Simulated research desk. Not an order. Not advice.”

### Offline setup verification

`node --test test/setup.test.mjs` checks missing prerequisites, explicit bundle
provisioning, overwrite refusal and import/type resolution in a temporary export
of tracked working-tree files plus the explicitly listed setup/Phase 0B/Desk corrections.
It adds only test-owned private sentinels (never workspace private implementations),
uses installed Node dependencies and a generated Prisma client, and never loads
the real root `.env`. Both Python environments and the initialized submodule must
already be installed at the paths above. It imports app dependencies and the real
Desk graph from the exported pin, with network connects and dotenv reads blocked
for the Desk import probe (synthetic dotenv files are planted only in the temp tree).
Fixtures prove setup/interface behavior, not private research
compatibility. Production provisioning requires the real operator bundle above.

`npm test` runs offline auth, broker and subprocess boundary mocks. Run
`.\.venv\Scripts\python.exe -m unittest discover -s test -p test_subprocess_env.py -v`
(Linux: `.venv/bin/python`) for Python environment-boundary tests. Full production
build, fixture browser acceptance, fresh dependency installation, native Linux,
applied migrations and live provider behavior are separate release gates, not
implied by these tests.

### Isolated production build verification

With the installed prerequisites above, use a **new absolute directory outside
this repository** (the driver refuses to overwrite an existing directory):

```powershell
node test/desk-release.mjs prepare C:/verification/oracle-release
node test/desk-release.mjs build C:/verification/oracle-release
```

This exports tracked source and an explicit corrections list, rejects unexpected
tracked edits, excludes the unrelated local ignore-rule change, verifies the
TradingAgents pin/clean tree, and provisions private test sentinels through the
supported provisioning helper. It reuses installed dependencies and a generated
Prisma client; it does not install, migrate, seed or connect to a database.
The build uses sentinel environment values, disabled telemetry, offline font CSS
and guards against dotenv reads and outbound Node connections/fetches. Logs,
source hashes and the exit result stay in the verification directory. Preserve
the logs; if deleting that directory later, unlink its dependency junctions before
recursive cleanup so installed dependencies cannot be traversed.

On 2026-10-05 the Windows sentinel `next build` passed. Prisma's attempted dotenv
reads were blocked by the guard and logged as `Schema Env Error`; no real secret
file was read. Font appearance, the real private research bundle, fresh installs,
applied migrations, live providers, native Linux and service-manager behavior are
not certified by this build. Browser acceptance was blocked by an admin-enforced
browser policy before the first page load; the release gate remains incomplete.

### YouTube Analysis

Monitor financial channels, store structured summaries in Postgres, and expose them to the AI Insights agent.

**Setup**

1. Enable **YouTube Data API v3** in [Google Cloud Console](https://console.cloud.google.com/) and create an API key. Set `YOUTUBE_API_KEY` in `.env`.
2. Ensure `OPENROUTER_API_KEY` is set (used for video summarization; same key as AI Insights).
3. Install Python deps (includes YouTube packages):

```bash
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

4. Copy the channels template and edit as needed:

```bash
copy conf\youtube_channels.json.example conf\youtube_channels.json
```

5. Apply the Prisma model (includes `YoutubeVideoSummary`):

```bash
npm run db:push
```

6. Open the dashboard → YouTube icon → **Poll all channels**, or use the CLI:

```bash
python scripts/youtube_ingest.py channel @CNBC 5
python scripts/youtube_ingest.py poll conf/youtube_channels.json
python scripts/market_data.py youtube channel @CNBC 5
```

Direct Python commands require configuration in the launching shell; they do not
load the application `.env`. App routes pass only their allowed settings from the
Next parent. The polling wrappers likewise filter the child environment.

**Insights agent**

Ask AI Insights about recent CNBC/Bloomberg commentary. The agent calls `get_youtube_channel_insights` (see harness skill `youtube-research.md`), cites video URLs in pick `sources`, and treats YouTube claims as qualitative supplements to `quant_indicators`.

**Optional nightly cron**

- Linux/macOS: `scripts/youtube_poll_cron.sh`
- Windows Task Scheduler: `scripts/youtube_poll_cron.ps1`

After CLI poll, use the dashboard **Poll** button (or Insights `refresh: true`) so results are upserted into Postgres for browsing and agent queries.

### Market data (`full` command)

`GET /api/market/full?symbol=AAPL` returns the standard bundle plus quant keys. Quotes and history come from Yahoo Finance. Webull is used only for the admin broker panel.

| Key | Fields |
|-----|--------|
| `quant_indicators` | `rsi_14`, `macd_histogram`, `bollinger_pct_b`, `above_sma50` |
| `risk_metrics` | `ann_vol_pct`, `max_drawdown_pct`, `hist_var_95_pct` |
| `predictive` | `expected_return_pct`, `std_err_pct`, `method`, `horizon_days` |
| `strategy_signals` | `regime`, `primary_signal`, `atr_value`, `suggested_risk_pct`, `correlation_filter_active`, `notes` |
| `data_sources` | `quote`, `history`, `news`, `sentiment`, `fundamentals` (Yahoo) |

CLI: `python scripts/market_data.py full AAPL`  
Broker health: `python scripts/webull_client.py health` (loads `WEBULL_*` from env / `.env` via Next)
## Disclaimer

This application surfaces market **indicators and signals** for informational purposes only. It does not provide investment advice, predictions, or guarantees. Always verify data independently and consult a qualified professional before making financial decisions.

## Third-party

Trading Desk runs [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)
(Apache License 2.0). The upstream license is in `TradingAgents/LICENSE`.
Oracle is not affiliated with Tauric Research. Desk output is a research
simulation, not an order and not investment advice.

## License

[MIT](LICENSE) — Copyright (c) 2026 Aditya Singh
