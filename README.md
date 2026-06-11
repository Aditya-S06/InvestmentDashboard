# Investment Dashboard

A self-hosted financial intelligence dashboard for tracking equities and building a personal watchlist. Built for investors who want a consolidated view of price action, sentiment signals, risk metrics, and macro context—without relying on a proprietary hosted platform.

Live market data is sourced from [Yahoo Finance](https://finance.yahoo.com/) via `yfinance`. User accounts, watchlists, and settings are stored in PostgreSQL.

## Features

- **Watchlist** — Starter mega-cap symbols (AAPL, MSFT, GOOGL, and peers) on first login; add or remove tickers and group them in the sidebar.
- **Ticker grid** — Real-time quotes, day change, sentiment bar, and risk badge for tracked symbols.
- **Detail modal** — Price history, RSI/MACD, analyst consensus, news with credibility tags, Kelly position sizing, and exit alerts.
- **Macro ribbon** — VIX, S&P 500, 10Y Treasury, Fed Funds, and US market open/closed status.
- **Ticker search** — Autocomplete and direct symbol entry.
- **Authentication** — Email/password sign-in with NextAuth.js; per-user watchlists persisted in the database.
- **Optional API keys** — Alpha Vantage and Polygon.io keys can be stored per user (settings modal).

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, React 18, Tailwind CSS, Recharts |
| Backend | Next.js API routes, NextAuth.js v4 |
| Database | PostgreSQL, Prisma ORM |
| Market data | Python 3, `yfinance`, `pytz` |
| Local DB | Docker Compose (Postgres 16) |

## Architecture

```
Browser → Next.js (dashboard, auth)
              ├── /api/market/*  →  Python (scripts/market_data.py)  →  Yahoo Finance
              ├── /api/watchlist/*  →  Prisma  →  PostgreSQL
              └── /api/auth/*  →  NextAuth  →  PostgreSQL
```
## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Python](https://www.python.org/) 3.10+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (recommended for PostgreSQL)  
  — or a local/cloud Postgres instance

### Installation

```bash
git clone https://github.com/Aditya-S06/InvestmentDashboard.git
cd InvestmentDashboard

# Node dependencies
npm install

# Python environment (market data)
python -m venv .venv
# Windows
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# macOS / Linux
# source .venv/bin/activate && pip install -r requirements.txt

# Environment
cp .env.example .env   # Windows: copy .env.example .env
# Edit .env — set NEXTAUTH_SECRET to a long random string

# Database (Docker)
npm run db:up
npm run setup
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**Development seed account** (created by `npm run setup`): `john@doe.com` / `johndoe123`  
Change or remove this user before any production deployment.

### NPM scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run db:up` | Start Postgres container |
| `npm run db:down` | Stop Postgres container |
| `npm run db:push` | Apply Prisma schema |
| `npm run db:seed` | Seed demo user and starter watchlist |
| `npm run setup` | `prisma generate` + `db push` + `seed` |

### Without Docker

Install PostgreSQL, create a database (e.g. `market_intel`), set `DATABASE_URL` in `.env`, then run `npm run setup`.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | Yes | Random secret for session signing |
| `NEXTAUTH_URL` | Yes | App URL (e.g. `http://localhost:3000`) |

See [`.env.example`](.env.example) for a template.

## Disclaimer

This application surfaces market **indicators and signals** for informational purposes only. It does not provide investment advice, predictions, or guarantees. Always verify data independently and consult a qualified professional before making financial decisions.

## License

[MIT](LICENSE) — Copyright (c) 2026 Aditya Singh
