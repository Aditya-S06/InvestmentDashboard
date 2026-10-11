# Market data lanes (D0 classification)

Two legal lanes for all market data in this app. Read this before touching
any file under `app/api/market/`, `scripts/market_data.py`,
`scripts/webull_client.py`, or `scripts/display_data.py` (D2).

## The rule in one paragraph

Webull Nasdaq non-display data (our authorized subscription) may feed
machines only: the quant engine, the Tauric Desk agent, the AI Insights chat
tools, and the paper-trading fill engine. It must never reach a pixel: no
quotes, charts, depth, or bars from Webull in any rendered component.
Everything on screen (quote cards, `PriceChart`, macro strip, analyst, news,
search) must come from a display-licensed source. Model prose that cites a
number as part of analysis (chat answers, Desk memos) is derived analysis,
the textbook non-display use case — but raw Webull fields are never passed
through verbatim to the client for display.

## Entitlement (fill in from the Advanced Quotes Center)

- Subscription held: Nasdaq non-display for OpenAPI usage (free data,
  authorized). Confirm exact tier: Basic L1 | TotalView L2 (circle one):
  `________`. How: log in to the Webull Technology site → avatar →
  Advanced Quotes → OpenAPI Advanced Quotes.
- Unlocked non-display endpoints for the confirmed tier: snapshots
  (`GET /market-data/stocks/snapshots/list`), historical bars
  (`POST /market-data/stocks/bars/list`), plus ticks, depths, footprint,
  NOII (L2 only), streaming subscribe/unsubscribe.
- App/QT store subscriptions do NOT count for OpenAPI. Sandbox mirrors the
  prod entitlement, so sandbox serves real-time (not 15-min delayed) while
  the prod subscription is active.
- Single-device rule: exactly one LV1/LV2 consumer at a time. The server
  (Python layer) is that device. Never stream or poll LV data from a dev
  laptop while the server runs.

## Lane map (verified Oct 2026 against code)

DISPLAY — screen-rendered, display-licensed source only, never Webull:

- `GET /api/market/cards` → watchlist grid (`quotes-provider.tsx`).
  Current: Yahoo `cards` action, 40-symbol batch, 20s server cache
  (`lib/market/cache.ts`), once-per-symbol fetch per session plus
  sessionStorage. Target: Finnhub quotes/profile.
- `GET /api/market/historical` → `PriceChart` (detail modal) and paper
  charts (`trade-detail-drawer`, `paper-client`). Current: Yahoo OHLCV.
  Target: Stooq EOD CSV (TradingView embed is the fallback, D2 decision).
- `GET /api/market/macro` → dashboard macro strip, polled every 60s
  (`quotes-provider.tsx`). Current: Yahoo `^VIX`/`^GSPC`/`^TNX`.
  Target: Finnhub quotes + FRED for rates.
- `GET /api/market/search` → `ticker-search.tsx`. Current: static dict +
  Yahoo fallback. Target: Finnhub symbol search (verify Webull instrument
  search first, D2).
- `GET /api/market/full` (DISPLAY slice) → detail modal + trade-plan
  modal render analyst/news/technicals. See DUAL note below.

NONDISPLAY — backend only, Webull-first, never imported by client code:

- `lib/paper/market.ts` (`getPaperQuote(s)`, `calculateHistoricalExcursion`)
  — server-only fill prices and MFE/MAE bars. Target D1: Webull first.
- `lib/webull/orders.ts` order validation (`runPython(['ticker'])).
  Target D1: Webull snapshot.
- `GET /api/health` (AAPL smoke quote). Stays Yahoo or moves to Webull
  snapshot; never displayed.
- Tauric Desk graph (`scripts/trading_desk_runner.py` → local-only
  `TradingAgents/` clone): market/social/news/fundamentals analysts.
  Target D1: Webull adapter; Yahoo stays as fallback.
- AI Insights `get_ticker_fundamentals` → `runPython(['full'])`
  (see `lib/insights/tools.example.ts`). Receives Webull-fed quant
  transparently after D1; its prose output is derived analysis.
- `GET /api/market/ticker` — no UI consumers today; server/health/order
  use only. Do NOT wire to UI without reclassifying to DISPLAY.
- `GET /api/market/sentiment`, `GET /api/market/risk` — no callers today.
  Internal-only; D3 moves or removes them.

DUAL — must split in D3:

- `GET /api/market/full` serves the detail modal AND the AI chat tool
  today. D3 splits it into a DISPLAY slice (licensed data for rendering)
  and an internal BACKEND slice (Webull-fed quant for chat/desk).

## Limits that constrain the implementation

- Webull Data API HTTP: 300 req/60s overall; per-endpoint 30/60s sandbox,
  60/60s prod. Repo already throttles to 30/min (`WEBULL_RATE_LIMIT_PER_MIN`).
  In-process caches: snapshots 60s, bars 300s (`scripts/webull_client.py`).
  Current display polling (macro 60s, cards once-per-symbol) fits easily.
- Webull streaming: max 5 concurrent connections per app key, unique
  `session_id`, manual resubscribe after reconnect, protobuf payloads.
  Deferred to a dedicated worker (D4) — never the request path.
- Finnhub free (personal use, fits this non-commercial single-user app):
  60 calls/min; real-time quotes, profiles, news, analyst, 50-symbol
  WebSocket; NO candles endpoint on free; thin US-only fundamentals.
  Terms: strictly personal use, no redistribution or sharing of data or
  derived results with any third party without written approval;
  disqualified if used by/for a business, expensed, or by a registered
  securities professional; data must be deleted if the subscription ends.
  Full text: `https://finnhub.io/terms-of-service` (read Oct 2026).
- Stooq CSV: personal non-commercial use OK; redistribution/republishing
  requires consent. Operational catches (verified Oct 2026): API key via
  site CAPTCHA now required, unpublished daily per-IP hit quota that
  returns an HTML/"exceeded" body instead of CSV — fragile for unattended
  server pulls, which is why D2 decides between Stooq and a TradingView
  embed for charts.
- Yahoo (status quo): unofficial scraping, flaky `.info`, rate limits.
  Fallback only during D1/D2 rollout; leaves `requirements.txt` after a
  two-week clean window (D5).

## D0 verification

- [x] This doc exists and is committed (allowlisted in `.gitignore`).
- [x] Every route in `app/api/market/*` carries a lane comment.
- [ ] Entitlement tier (Basic L1 vs TotalView L2) filled in above.
- [ ] Finnhub + Stooq terms re-checked at D5 gate (terms change).
