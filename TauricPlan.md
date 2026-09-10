---
name: TauricPlan
overview: Add /dashboard/desk wrapping TauricResearch/TradingAgents. Insights harness is untouched.
todos:
  - id: desk-0-map
    content: Map sidebar, Insights header, auth/key resolution, existing Python spawn pattern, User model. No code.
    status: pending
  - id: desk-1-scaffold
    content: DeskRun Prisma model, lib/desk types/config/access, API stubs, empty /dashboard/desk page
    status: pending
  - id: desk-2-chrome
    content: Sidebar item, Insights header link, launch form, recent-runs list, run page stub
    status: pending
  - id: desk-3-engine
    content: scripts/trading_desk_runner.py wrapping TradingAgentsGraph with JSONL events
    status: pending
  - id: desk-4-live
    content: Spawn runner, SSE stream, live six-phase floor, cancel
    status: pending
  - id: desk-5-report
    content: Report tabs from finalState, watchlist add, Send to Insights, download, re-run
    status: pending
  - id: desk-6-harden
    content: Sequential multi-ticker, weighted rate limit, checkpoint isolation, timeouts, redaction
    status: pending
isProject: false
---

# TauricPlan

Implementation spec for Project Oracle (`project_oracle` repo root). Attach `@TauricPlan.md` only.

Tauric lives at repo-root `TradingAgents/` (`project_oracle/TradingAgents`). Not `vendor/TradingAgents`. Todos `desk-0` through `desk-2` must not stub a fake `tradingagents` package. `desk-3-engine` imports from that tree; spawn sets `PYTHONPATH` to `<repo>/TradingAgents`.

Implement one todo id per session. Do not start the next id in the same session. Do not edit files outside that id’s allow-list.

## Product

| Surface | Route | Engine |
|---------|-------|--------|
| Insights | `/dashboard/insights` | Existing harness + OpenRouter tool loop |
| Trading Desk | `/dashboard/desk` | `TradingAgents/TradingAgentsGraph` |

Desk is a page wrapper around the Tauric CLI, not a rewrite of Tauric agents and not an Insights skill.

Flow:

```
CreateDeskRunInput
  → POST /api/desk/runs
  → scripts/trading_desk_runner.py
  → TradingAgentsGraph(selected_analysts, config).propagate(ticker, as_of, asset_type)
  → JSONL on stdout
  → GET /api/desk/runs/[id]/stream
  → /dashboard/desk/runs/[id]
```

Depth → rounds:

| depth    | max_debate_rounds | max_risk_discuss_rounds |
|----------|-------------------|-------------------------|
| fast     | 1                 | 1                       |
| standard | 3                 | 3                       |
| deep     | 5                 | 5                       |

Analyst keys, Tauric order: `market`, `social`, `news`, `fundamentals`.  
Asset `crypto` drops `fundamentals`.  
Ratings: `Buy` | `Overweight` | `Hold` | `Underweight` | `Sell` | `REVIEW`. Never coerce `REVIEW` to `Hold`.  
Default form depth: `standard`. Max tickers: 3, sequential.

## Forbidden

- `lib/insights/harness/**`
- Insights `orchestrator.ts` tool loop
- `system.md`, `output.md`, Insights `skills/*.md`
- Reimplementing Tauric analysts in TypeScript
- `submit_stock_insights` from Desk
- Writing Desk rows into `InsightMessage` except the explicit “Send to Insights” action
- Broker / order execution
- Parallel Deep graphs
- Writing to `~/.tradingagents`

## Files

```
prisma/schema.prisma
app/dashboard/desk/page.tsx
app/dashboard/desk/runs/[id]/page.tsx
app/dashboard/desk/_components/desk-launch-form.tsx
app/dashboard/desk/_components/desk-recent-runs.tsx
app/dashboard/desk/_components/desk-run-timeline.tsx
app/dashboard/desk/_components/desk-memo-pane.tsx
app/dashboard/desk/_components/desk-event-log.tsx
app/dashboard/desk/_components/desk-report.tsx
app/api/desk/runs/route.ts
app/api/desk/runs/[id]/route.ts
app/api/desk/runs/[id]/stream/route.ts
lib/desk/types.ts
lib/desk/config.ts
lib/desk/access.ts
lib/desk/runner.ts
scripts/trading_desk_runner.py
TradingAgents/                         # existing Tauric clone at repo root
```

Also: dashboard sidebar component (nav item), Insights header (link only).

## Contracts

```prisma
model DeskRun {
  id           String   @id @default(cuid())
  userId       String
  tickers      String[]
  activeTicker String?
  asOf         String
  depth        String
  analysts     String[]
  assetType    String   @default("stock")
  checkpoint   Boolean  @default(false)
  status       String
  signal       String?
  params       Json?
  finalState   Json?
  error        String?  @db.Text
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  finishedAt   DateTime?
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
}
```

`status`: `queued` | `running` | `completed` | `failed` | `cancelled` | `review`

```ts
type DeskDepth = "fast" | "standard" | "deep"
type DeskAnalyst = "market" | "social" | "news" | "fundamentals"
type CreateDeskRunInput = {
  tickers: string[]      // 1–3, uppercased
  asOf: string           // YYYY-MM-DD
  depth: DeskDepth
  analysts: DeskAnalyst[] // min 1
  assetType: "stock" | "crypto"
  checkpoint: boolean
}
```

```ts
DEPTH_ROUNDS = { fast: 1, standard: 3, deep: 5 }
RATE_WEIGHT  = { fast: 1, standard: 2, deep: 3 }
```

JSONL events (stdout, flushed):

```json
{"event":"phase","phase":"analysts","ticker":"NVDA"}
{"event":"agent","agent":"market","status":"start"}
{"event":"memo","agent":"market","text":"..."}
{"event":"debate","round":1,"side":"bull","text":"..."}
{"event":"decision","signal":"Overweight"}
{"event":"done"}
{"event":"error","message":"..."}
```

`agent` values: `market` `social` `news` `fundamentals` `bull` `bear` `research_manager` `trader` `risky` `safe` `neutral` `portfolio_manager`  
Unmapped node names still emit `agent` start/done with the raw name.

`phase` values: `analysts` `debate` `research_manager` `trader` `risk` `portfolio_manager`

SSE names on the HTTP stream: `desk_phase` `desk_agent` `desk_memo` `desk_debate` `desk_decision` `desk_done` `desk_error`

Env consumed by the runner:

```
OPENROUTER_API_KEY
OPENROUTER_BASE_URL          # default https://openrouter.ai/api/v1
DESK_DEEP_MODEL
DESK_QUICK_MODEL
PYTHONPATH                   # must include <repo>/TradingAgents
DESK_DATA_ROOT
```

`results_dir` = `{DESK_DATA_ROOT}/{userId}/{runId}`  
`memory_log_path` = `{DESK_DATA_ROOT}/{userId}/trading_memory.md`

Disclaimer copy on Desk UI: `Simulated research desk. Not an order. Not advice.`

---

## desk-0-map

Allow: none (analysis only).

Locate and name: dashboard sidebar, Insights header, Insights access/key resolution, existing `runPython` / `market_data.py` spawn pattern, Prisma `User` model.

Output the exact paths for later todos. Do not write code.

---

## desk-1-scaffold

Allow: `prisma/schema.prisma`, `lib/desk/types.ts`, `lib/desk/config.ts`, `lib/desk/access.ts`, `app/api/desk/runs/route.ts`, `app/api/desk/runs/[id]/route.ts`, `app/dashboard/desk/page.tsx`

- Add `DeskRun` and the `User` reverse relation. Migration included.
- Types and `DEPTH_ROUNDS` / `RATE_WEIGHT` / path helpers as specified.
- `access.ts` reuses Insights auth + OpenRouter key resolution. No new key path.
- `POST /api/desk/runs` auth + Zod + insert `queued`. Do not spawn Python.
- `GET /api/desk/runs` current user, newest first, limit 30.
- `GET /api/desk/runs/[id]` 404 if missing or other user.
- `/dashboard/desk` auth-gated placeholder page titled Trading Desk.

---

## desk-2-chrome

Allow: dashboard sidebar, Insights header (link only), `app/dashboard/desk/**`

- Sidebar item `Trading Desk` → `/dashboard/desk`. Existing nav styles only.
- Insights header text button `Trading Desk →` → `/dashboard/desk`. No other Insights behavior change.
- `desk-launch-form.tsx`: ticker chips max 3; Use watchlist fills first 3 from existing watchlist source; as-of default today `America/New_York`; depth chips default standard; analyst checkboxes default all four; asset stock|crypto, crypto unchecks and disables Fundamentals; checkpoint default off; submit POST then `router.push(/dashboard/desk/runs/[id])`.
- `desk-recent-runs.tsx` from GET list: status, signal badge, time; click → run page.
- `/dashboard/desk/runs/[id]` stub showing GET status.
- Footer disclaimer.

---

## desk-3-engine

Allow: `scripts/trading_desk_runner.py`, `lib/desk/config.ts`. Do not move or re-clone `TradingAgents/`.

```
python scripts/trading_desk_runner.py
  --ticker NVDA --as-of 2026-09-09 --depth fast
  --analysts market,social,news,fundamentals
  --asset-type stock --checkpoint false
  --out /tmp/desk-out.json --results-dir /tmp/desk-results
```

- Import `TradingAgentsGraph` + `DEFAULT_CONFIG` from `project_oracle/TradingAgents` (package dir `tradingagents` inside that clone). Do not invent a stub module. Do not look under `vendor/`.
- Map depth to both debate and risk round counts.
- `selected_analysts` in Tauric order.
- Config: OpenRouter-compatible provider (`openai_compatible` + base URL, or native `openrouter` if present); models from `DESK_DEEP_MODEL` / `DESK_QUICK_MODEL`; `checkpoint_enabled`; `results_dir` / `memory_log_path` under `--results-dir`.
- `TradingAgentsGraph(..., debug=True)` then `propagate`.
- JSONL events as specified. Hook debug stream / callbacks. Map Tauric node names onto the `agent` list above.
- Write `{ signal, finalState }` to `--out`. Unparseable rating → `REVIEW`.
- No `input()`. Missing API key is a hard error.
- Do not call this from Next.js in this todo.

---

## desk-4-live

Allow: `lib/desk/runner.ts`, `app/api/desk/runs/**`, `app/dashboard/desk/runs/[id]/**`, timeline / memo / event-log components

- Spawn the Python runner with DeskRun params. Env: resolved OpenRouter key + model vars + `PYTHONPATH=<repo>/TradingAgents`. cwd = repo root.
- Parse JSONL. Persist events for replay. On done: `completed` + signal + finalState. On error: `failed`. Cancel: SIGTERM + `cancelled`.
- POST create starts the runner and returns 201 immediately (`running`). Do not await the graph.
- `GET /api/desk/runs/[id]/stream` SSE, auth, replay then tail, close on terminal status.
- `DELETE /api/desk/runs/[id]` cancels.
- Live UI: header (tickers, depth, elapsed, status); six-phase timeline (Analysts chips for selected only; Debate + round; Research Manager; Trader; Risk Risky/Safe/Neutral; Portfolio Manager); memo pane; event log; Cancel; disclaimer.
- If the host cannot hold a child in-request, detach + event file under `results_dir` and tail that file. Comment the choice at the top of `runner.ts`.
- No report tabs in this todo.

---

## desk-5-report

Allow: `desk-report.tsx`, run page, existing watchlist POST consumer, Insights session-create call site

When status is `completed` or `review`, render report tabs: Overview | Analysts | Debate | Trader | Risk | Decision.

Map `finalState` from a real runner `--out`. Expected Tauric keys include market/social/news/fundamentals reports, `investment_debate_state`, research/investment plan, trader proposal, risk debate, portfolio / final trade decision.

Overview: rating badge including REVIEW; executive summary; horizon / entry / stop / sizing when present; bull vs bear excerpts.

Actions:

- Add ticker to existing watchlist API.
- Send to Insights: new `InsightSession` whose first user message is a markdown digest (ticker, rating, thesis). Do not modify Insights system prompt or harness.
- Download markdown or zip from `results_dir` / Tauric `save_reports`.
- Re-run: POST a new DeskRun cloned from `params`.

---

## desk-6-harden

Allow: `lib/desk/runner.ts`, `lib/desk/config.ts`, desk API routes, launch form, existing rate-limit helper

- Multiple tickers on one DeskRun run sequentially. Update `activeTicker`. Header `NVDA 1/2`. One graph at a time.
- Rate limit: Insights limiter with `RATE_WEIGHT`, or `DESK_RATE_LIMIT_PER_HOUR=4`. Document the choice in `config.ts`. 429 names the bucket and remaining.
- Checkpoint: `checkpoint_enabled` passthrough; Resume control when a per-user+ticker sqlite exists; Clear checkpoint deletes only that user’s ticker file.
- Isolation paths as specified. Never `$HOME/.tradingagents`.
- Wall targets: fast ~90s, deep ~300s, then `failed` with timeout message (mention resume if checkpoint was on).
- Do not log API keys. Redact env in error strings.
