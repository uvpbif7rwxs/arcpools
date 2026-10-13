/**
 * Storage layer.
 *
 * The PRD specifies Supabase/PostgreSQL. This project ships a zero-config
 * SQLite store (better-sqlite3) so `npm run sync` works immediately without
 * provisioning a cloud database; the schema sticks to portable types
 * (TEXT identifiers, REAL for USD amounts, NULL for missing) so the migration
 * to Postgres is a driver change rather than a rewrite.
 *
 * NULL means "not known". A missing value is never coerced to 0 anywhere in
 * this codebase — see ADR in README.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DB_PATH =
  process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "arcpools.db");

let instance: Database.Database | undefined;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pools (
  pool_key          TEXT PRIMARY KEY,        -- chain:dex:identifier (canonical)
  chain_id          INTEGER NOT NULL,
  dex_id            TEXT NOT NULL,
  dex_name          TEXT,
  dex_version       TEXT,                     -- v2 | v3 | v4 | unknown
  pool_identifier   TEXT NOT NULL,           -- address OR bytes32 v4 pool id
  identifier_kind   TEXT NOT NULL,           -- address | bytes32
  base_symbol       TEXT,
  base_token_address TEXT,
  quote_symbol      TEXT,
  quote_token_address TEXT,
  fee_tier_label    TEXT,
  pool_created_at   TEXT,                     -- on-chain creation time, never first_seen
  first_seen_at     TEXT NOT NULL,
  source            TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pools_identity_idx
  ON pools (chain_id, dex_id, pool_identifier);
CREATE INDEX IF NOT EXISTS pools_liq_rank_idx
  ON pools (pool_key);
CREATE INDEX IF NOT EXISTS pools_created_idx ON pools (pool_created_at DESC);
CREATE INDEX IF NOT EXISTS pools_search_idx
  ON pools (base_symbol, quote_symbol, base_token_address);

CREATE TABLE IF NOT EXISTS tokens (
  chain_id        INTEGER NOT NULL,
  address         TEXT NOT NULL,
  name            TEXT,
  symbol          TEXT,
  decimals        INTEGER,
  image_url       TEXT,
  market_cap_usd  REAL,                       -- NULL = unverified, never FDV fallback
  fdv_usd         REAL,
  holders_count   INTEGER,                    -- Phase 2; NULL while unindexed
  holders_updated_at TEXT,
  PRIMARY KEY (chain_id, address)
);

CREATE TABLE IF NOT EXISTS pool_metrics (
  pool_key        TEXT PRIMARY KEY REFERENCES pools(pool_key) ON DELETE CASCADE,
  liquidity_usd   REAL,
  volume_24h_usd  REAL,
  volume_7d_usd   REAL,
  price_usd       REAL,
  price_change_24h REAL,
  fee_rate        REAL,                       -- effective LP fee fraction (0.003 = 0.3%)
  fee_source      TEXT,                       -- detail_api | pool_name | unknown
  apr_24h         REAL,
  apr_7d          REAL,
  apr_method      TEXT,
  apr_confidence  TEXT,                       -- verified | estimated | low_history | na
  apr_reason      TEXT,                       -- why it is N/A when apr_confidence = na
  source          TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  stale           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pool_metrics_liq_idx ON pool_metrics (liquidity_usd DESC);
CREATE INDEX IF NOT EXISTS pool_metrics_v24_idx ON pool_metrics (volume_24h_usd DESC);
CREATE INDEX IF NOT EXISTS pool_metrics_apr_idx ON pool_metrics (apr_24h DESC);

CREATE TABLE IF NOT EXISTS pool_snapshots (
  pool_key      TEXT NOT NULL REFERENCES pools(pool_key) ON DELETE CASCADE,
  captured_at   TEXT NOT NULL,
  liquidity_usd REAL,
  volume_24h_usd REAL,
  est_apr_24h   REAL,
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
  last_success_at TEXT,
  last_error      TEXT,
  next_run_at     TEXT,
  stats_json      TEXT
);
`;

export function getDb(): Database.Database {
  if (instance) return instance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.exec(SCHEMA);
  return instance;
}

export function dbFilePath(): string {
  return DB_PATH;
}