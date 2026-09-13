# Parallax — Equity Intelligence

An institutional-grade stock research platform: search any supported ticker for
live quotes, fundamentals, earnings history, analyst data, news, an AI research
assistant, and structured 12-month bull/base/bear scenario forecasts.

Built with **Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS ·
Recharts**. Runs with **zero configuration** — a deterministic mock data
provider powers the entire interface so it is fully previewable without any API
keys.

## Quick start

```bash
npm install
npm run dev        # http://localhost:3007
```

No `.env` is required for development. To wire in live data or the AI model,
copy `.env.example` to `.env.local` and populate the keys you have.

## Architecture

```
src/
  app/                     Routes (App Router) + API route handlers
    api/                   search · quote · candles · news · screener ·
                           watchlist · ai/chat · ai/forecast
    stocks/[ticker]/       The stock detail page (header, chart, AI outlook, tabs)
  components/
    layout/  charts/  stocks/  earnings/  financials/  news/  ai/  common/
  lib/
    api/                   Data-access layer
      provider.ts          DataProvider interface — the ONLY contract the UI uses
      index.ts             Provider selection + TTL cache
      mock/                Deterministic reference provider (universe, model,
                           generators, market)
    forecasting/           Deterministic forecast engine (drivers → scenarios)
    ai/                    System prompt, context assembly, local answerer
    db/schema.sql          Postgres/Supabase schema (Phase 2 persistence)
  types/                   Shared domain types
  hooks/                   useWatchlist · useDebounce
```

### Data provider abstraction

Every screen depends only on the `DataProvider` interface (`lib/api/provider.ts`).
The shipped implementation is `mock/mockProvider.ts`, which derives all figures
from a single per-company financial model (`mock/model.ts`) seeded by ticker, so
the numbers reconcile (market cap = price × shares, EPS = net income / shares,
P/E = price / EPS, …). Swapping in Finnhub / FMP / Polygon means implementing
the same interface and selecting it in `lib/api/index.ts` via `DATA_PROVIDER` —
no UI changes.

### Forecast engine

Forecasting is deterministic first, AI second (`lib/forecasting`):

1. `drivers.ts` computes real financial metrics (growth, margins, valuation vs
   history, momentum, volatility, beat rate, cash runway, dilution…).
2. `generateScenarioForecast.ts` projects revenue → EPS → applies a
   growth-faded exit multiple, anchored to the company's own history and the
   analyst range, producing bear/base/bull targets with stored assumptions,
   risks and catalysts. Data coverage and confidence are assessed from what is
   actually available (small-caps surface as lower coverage).

The AI layer only *interprets* these numbers — it never manufactures them.

### AI assistant

`POST /api/ai/chat` grounds responses in the structured context assembled by
`lib/ai/context.ts`. With `ANTHROPIC_API_KEY` set it calls the model; without a
key, a deterministic local answerer (`lib/ai/localAnswer.ts`) produces grounded,
cited responses from the same data, so the AI surface is genuinely functional in
development.

## Design

Restrained graphite terminal palette; green/red reserved for directional
movement. Hierarchy from weight, spacing and hairline borders — not cards,
shadows or gradients. Tabular figures throughout. Tokens live in
`tailwind.config.ts` (mirrored as CSS variables in `app/globals.css`).

## Scripts

| command | description |
| --- | --- |
| `npm run dev` | Dev server on :3007 |
| `npm run build` | Production build |
| `npm start` | Serve the production build |

## Notes

Market/company data in development is **synthesised** for realism and internal
consistency — it is not live market data. Forecasts are AI/model-generated
scenarios, not financial advice.
