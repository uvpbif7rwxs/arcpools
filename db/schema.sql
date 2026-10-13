-- ArcPools schema (PostgreSQL).
--
-- The running project uses SQLite via better-sqlite3 so `npm run sync` works
-- with zero provisioning; this file is the portable equivalent for the
-- Supabase/Postgres deployment described in the README.
--
-- Two rules carry over unchanged:
--   * NULL means "unknown" — never coerce a missing metric to 0;
--   * USD amounts use NUMERIC, not FLOAT, and pool identity is
--     chain + dex + pool_identifier (bytes32 Pool ID for Uniswap v4).

CREATE TABLE IF NOT EXISTS pools (
  pool_key            TEXT PRIMARY KEY,
  chain_id            INTEGER NOT NULL,
  dex_id              TEXT NOT NULL,
  dex_name            TEXT,
  dex_version         TEXT,
  pool_identifier     TEXT NOT NULL,
  identifier_kind     TEXT NOT NULL,
  base_symbol         TEXT,
  base_token_address  TEXT,
  quote_symbol        TEXT,
  quote_token_address TEXT,
  fee_tier_label      TEXT,
  pool_created_at     TIMESTAMPTZ,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source              TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pools_identity_idx
  ON pools (chain_id, dex_id, pool_identifier);
CREATE INDEX IF NOT EXISTS pools_created_idx ON pools (pool_created_at DESC);
CREATE INDEX IF NOT EXISTS pools_search_idx
  ON pools (base_symbol, quote_symbol, base_token_address);

CREATE TABLE IF NOT EXISTS tokens (
  chain_id           INTEGER NOT NULL,
  address            TEXT NOT NULL,
  name               TEXT,
  symbol             TEXT,
  decimals           INTEGER,
  image_url          TEXT,
  market_cap_usd     NUMERIC,          -- NULL = unverified; never an FDV fallback
  fdv_usd            NUMERIC,
  holders_count      INTEGER,          -- Phase 2
  holders_updated_at TIMESTAMPTZ,
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE IF NOT EXISTS pool_metrics (
  pool_key         TEXT PRIMARY KEY REFERENCES pools(pool_key) ON DELETE CASCADE,
  liquidity_usd    NUMERIC,
  volume_24h_usd   NUMERIC,
  volume_7d_usd    NUMERIC,
  price_usd        NUMERIC,
  price_change_24h NUMERIC,
  fee_rate         NUMERIC,           -- effective LP fee fraction, 0.003 = 0.3%
  fee_source       TEXT,              -- detail_api | pool_name | unknown
  apr_24h          NUMERIC,
  apr_7d           NUMERIC,
  apr_method       TEXT,
  apr_confidence   TEXT,              -- verified | estimated | low_history | na
  apr_reason       TEXT,
  source           TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL,
  stale            BOOLEAN NOT NULL DEFAULT FALSE
);

-- Ranking index: the leaderboard sorts by liquidity over the full tracked set.
CREATE INDEX IF NOT EXISTS pool_metrics_liq_idx  ON pool_metrics (liquidity_usd DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS pool_metrics_v24_idx  ON pool_metrics (volume_24h_usd DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS pool_metrics_apr_idx  ON pool_metrics (apr_24h DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS pool_snapshots (
  pool_key       TEXT NOT NULL REFERENCES pools(pool_key) ON DELETE CASCADE,
  captured_at    TIMESTAMPTZ NOT NULL,
  liquidity_usd  NUMERIC,
  volume_24h_usd NUMERIC,
  est_apr_24h    NUMERIC,
  PRIMARY KEY (pool_key, captured_at)
);

CREATE INDEX IF NOT EXISTS pool_snapshots_time_idx ON pool_snapshots (captured_at DESC);

CREATE TABLE IF NOT EXISTS pool_flags (
  pool_key TEXT NOT NULL REFERENCES pools(pool_key) ON DELETE CASCADE,
  flag     TEXT NOT NULL,
  detail   TEXT,
  PRIMARY KEY (pool_key, flag)
);

CREATE TABLE IF NOT EXISTS sync_jobs (
  job_name        TEXT PRIMARY KEY,
  status          TEXT,
  last_success_at TIMESTAMPTZ,
  last_error      TEXT,
  next_run_at     TIMESTAMPTZ,
  stats_json      TEXT
);

-- Snapshot retention: hourly detail for 7 days, then daily rollups forever.
-- Run from cron; 7D APR needs >= 12 samples per pool.
-- DELETE FROM pool_snapshots WHERE captured_at < now() - interval '90 days';