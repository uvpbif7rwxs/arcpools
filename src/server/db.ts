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
  market_cap_checked_at TEXT,
  fdv_usd         REAL,
  holders_count   INTEGER,                    -- Phase 2; NULL while unindexed
  holders_updated_at TEXT,
  holders_checked_at TEXT,
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
  fee_checked_at  TEXT,
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

function ensureTokenCheckColumns(db: Database.Database): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(tokens)").all() as { name: string }[]).map((row) => row.name),
  );
  if (!columns.has("market_cap_checked_at")) {
    db.exec("ALTER TABLE tokens ADD COLUMN market_cap_checked_at TEXT");
  }
  if (!columns.has("holders_checked_at")) {
    db.exec("ALTER TABLE tokens ADD COLUMN holders_checked_at TEXT");
  }
}

function ensurePoolMetricCheckColumns(db: Database.Database): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(pool_metrics)").all() as { name: string }[]).map((row) => row.name),
  );
  if (!columns.has("fee_checked_at")) {
    db.exec("ALTER TABLE pool_metrics ADD COLUMN fee_checked_at TEXT");
  }
}

/**
 * One-off repair for rows written before the network-prefix fix.
 *
 * GeckoTerminal hands back token ids as "arc_0xabc…", which was stored
 * verbatim. Its per-token endpoint rejects that form with HTTP 404, so those
 * rows could never be enriched: 205 of 237 tokens were unreachable and market
 * cap coverage sat at ~5%. Normalizing the stored address makes the existing
 * data reachable again without a re-crawl.
 *
 * Both forms can be present for the same token, and `tokens.address` is part of
 * the primary key, so the prefixed row is merged into the bare one first (any
 * non-null field wins, preferring the row that actually carries data) and only
 * then deleted. Written to be idempotent: a second open finds nothing to do.
 */
function repairTokenAddresses(db: Database.Database): void {
  const prefixed = db
    .prepare("SELECT * FROM tokens WHERE address LIKE 'arc_0x%'")
    .all() as Record<string, unknown>[];
  if (prefixed.length === 0) return;

  const selectBare = db.prepare("SELECT * FROM tokens WHERE address = ?");
  const upsert = db.prepare(`
    INSERT INTO tokens (chain_id, address, name, symbol, decimals, image_url,
                        market_cap_usd, market_cap_checked_at, fdv_usd,
                        holders_count, holders_updated_at, holders_checked_at)
    VALUES (@chain_id, @address, @name, @symbol, @decimals, @image_url,
            @market_cap_usd, @market_cap_checked_at, @fdv_usd,
            @holders_count, @holders_updated_at, @holders_checked_at)
    ON CONFLICT(chain_id, address) DO UPDATE SET
      name      = COALESCE(excluded.name, tokens.name),
      symbol    = COALESCE(excluded.symbol, tokens.symbol),
      decimals  = COALESCE(excluded.decimals, tokens.decimals),
      image_url = COALESCE(excluded.image_url, tokens.image_url),
      market_cap_usd = COALESCE(excluded.market_cap_usd, tokens.market_cap_usd),
      market_cap_checked_at = COALESCE(excluded.market_cap_checked_at, tokens.market_cap_checked_at),
      fdv_usd        = COALESCE(excluded.fdv_usd, tokens.fdv_usd),
      holders_count  = COALESCE(excluded.holders_count, tokens.holders_count),
      holders_updated_at = COALESCE(excluded.holders_updated_at, tokens.holders_updated_at),
      holders_checked_at = COALESCE(excluded.holders_checked_at, tokens.holders_checked_at)
  `);
  const remove = db.prepare("DELETE FROM tokens WHERE address = ?");

  const merge = db.transaction(() => {
    for (const row of prefixed) {
      const bare = String(row.address).slice(4);
      const existing = selectBare.get(bare) as Record<string, unknown> | undefined;
      // Prefer whichever row actually carries a value for each field.
      const pick = (a: unknown, b: unknown) =>
        a === null || a === undefined ? (b ?? null) : a;
      upsert.run({
        chain_id: row.chain_id,
        address: bare,
        name: pick(row.name, existing?.name),
        symbol: pick(row.symbol, existing?.symbol),
        decimals: pick(row.decimals, existing?.decimals),
        image_url: pick(row.image_url, existing?.image_url),
        market_cap_usd: pick(row.market_cap_usd, existing?.market_cap_usd),
        market_cap_checked_at: pick(
          row.market_cap_checked_at,
          existing?.market_cap_checked_at,
        ),
        fdv_usd: pick(row.fdv_usd, existing?.fdv_usd),
        holders_count: pick(row.holders_count, existing?.holders_count),
        holders_updated_at: pick(row.holders_updated_at, existing?.holders_updated_at),
        holders_checked_at: pick(row.holders_checked_at, existing?.holders_checked_at),
      });
      remove.run(row.address);
    }
  });
  merge();
}

/** Keep pool foreign-key-like token addresses in the same canonical form. */
function repairPoolTokenAddresses(db: Database.Database): void {
  db.prepare(
    "UPDATE pools SET base_token_address = substr(base_token_address, 5) WHERE base_token_address LIKE 'arc_0x%'",
  ).run();
  db.prepare(
    "UPDATE pools SET quote_token_address = substr(quote_token_address, 5) WHERE quote_token_address LIKE 'arc_0x%'",
  ).run();
}

export function getDb(): Database.Database {
  if (instance) return instance;
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.exec(SCHEMA);
  ensureTokenCheckColumns(instance);
  ensurePoolMetricCheckColumns(instance);
  repairTokenAddresses(instance);
  repairPoolTokenAddresses(instance);
  return instance;
}

export function dbFilePath(): string {
  return DB_PATH;
}
