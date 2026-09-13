-- ===========================================================================
-- Parallax database schema (Postgres / Supabase)
--
-- Phase 1 stores the watchlist client-side (localStorage). This schema is the
-- server-side target for Phase 2: authentication, synced watchlists, AI history
-- and alerts. It is intentionally normalised with sensible IDs, timestamps and
-- relationships so it can be applied without reworking the app data model.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- Users -------------------------------------------------------------------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  display_name  text,
  auth_provider text not null default 'email',   -- 'email' | 'google'
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);

-- Reference company data (cached from providers) --------------------------
create table if not exists companies (
  ticker      text primary key,
  name        text not null,
  exchange    text not null,
  sector      text,
  industry    text,
  country     text,
  profile     jsonb,                              -- full CompanyProfile
  updated_at  timestamptz not null default now()
);

create table if not exists cached_quotes (
  ticker         text primary key references companies(ticker) on delete cascade,
  price          numeric not null,
  change_percent numeric,
  payload        jsonb,                           -- full Quote
  as_of          timestamptz not null default now()
);

create table if not exists financial_statements (
  id          bigserial primary key,
  ticker      text references companies(ticker) on delete cascade,
  period_type text not null,                      -- 'annual' | 'quarterly' | 'ttm'
  payload     jsonb not null,                     -- FinancialStatements
  fetched_at  timestamptz not null default now(),
  unique (ticker, period_type)
);

create table if not exists earnings (
  id            bigserial primary key,
  ticker        text references companies(ticker) on delete cascade,
  period        text not null,                    -- 'Q2 2026'
  report_date   date,
  eps_estimate  numeric,
  eps_actual    numeric,
  rev_estimate  numeric,
  rev_actual    numeric,
  unique (ticker, period)
);

create table if not exists analyst_estimates (
  ticker      text primary key references companies(ticker) on delete cascade,
  payload     jsonb not null,                     -- AnalystConsensus + actions
  updated_at  timestamptz not null default now()
);

create table if not exists news (
  id           text primary key,
  headline     text not null,
  summary      text,
  source       text not null,
  url          text not null,
  published_at timestamptz not null,
  category     text,
  tickers      text[] default '{}',
  sentiment    text
);
create index if not exists news_published_idx on news (published_at desc);
create index if not exists news_tickers_idx on news using gin (tickers);

-- Watchlists --------------------------------------------------------------
create table if not exists watchlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null default 'My Watchlist',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists watchlist_items (
  id           uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  ticker       text not null,
  added_at     timestamptz not null default now(),
  unique (watchlist_id, ticker)
);

-- AI analysis & forecasts (timestamped so changes are visible) ------------
create table if not exists ai_analysis (
  id          bigserial primary key,
  ticker      text not null,
  kind        text not null,                      -- 'thesis' | 'earnings' | 'summary'
  payload     jsonb not null,
  model_version text,
  generated_at timestamptz not null default now()
);

create table if not exists ai_forecasts (
  id            bigserial primary key,
  ticker        text not null,
  generated_at  timestamptz not null default now(),
  current_price numeric not null,
  bear_target   numeric not null,
  base_target   numeric not null,
  bull_target   numeric not null,
  bear_assumptions jsonb,
  base_assumptions jsonb,
  bull_assumptions jsonb,
  earnings_forecast jsonb,
  drivers       jsonb,                             -- deterministic snapshot
  model_version text not null,
  financial_data_snapshot jsonb
);
create index if not exists ai_forecasts_ticker_idx on ai_forecasts (ticker, generated_at desc);

create table if not exists ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade,
  ticker     text,
  title      text,
  created_at timestamptz not null default now()
);

create table if not exists ai_messages (
  id              bigserial primary key,
  conversation_id uuid not null references ai_conversations(id) on delete cascade,
  role            text not null,                   -- 'user' | 'assistant'
  content         text not null,
  citations       text[] default '{}',
  created_at      timestamptz not null default now()
);

-- Alerts (Phase 3) --------------------------------------------------------
create table if not exists alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  ticker     text not null,
  kind       text not null,                        -- 'price_above' | 'price_below' | 'pct_move' | 'earnings' | 'filing' | 'analyst' | 'volume' | 'forecast_change'
  threshold  numeric,
  active      boolean not null default true,
  created_at timestamptz not null default now(),
  triggered_at timestamptz
);
