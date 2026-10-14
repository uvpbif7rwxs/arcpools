/**
 * Read layer. Sorting, filtering and pagination all happen in SQL so the whole
 * tracked set is ranked before the page slice is taken — the PRD is explicit
 * that ranking is over the full set, not over the current page.
 */
import { getDb } from "./db";
import type { PoolFlag, PoolRow } from "./types";

export const SORTABLE = {
  liq: "m.liquidity_usd",
  mcap: "t.market_cap_usd",
  apr: "m.apr_24h",
  age: "p.pool_created_at",
  vol24h: "m.volume_24h_usd",
  updated: "m.updated_at",
} as const;

export type SortKey = keyof typeof SORTABLE;
export type AppliedSort = SortKey | "default";

export const DEFAULT_MIN_LIQ_USD = 10_000;

export type PoolQuery = {
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
  minLiq?: number | null;
  minApr?: number | null;
  maxAgeHours?: number | null;
  dex?: string | null;
  search?: string | null;
  /** Pools without a usable LIQ value sink to the bottom regardless of sort. */
  includeStale?: boolean;
};

const BASE_SELECT = `
  SELECT
    p.pool_key          AS poolKey,
    p.chain_id          AS chainId,
    p.dex_id            AS dexId,
    p.dex_name          AS dexName,
    p.dex_version       AS dexVersion,
    p.pool_identifier   AS poolIdentifier,
    p.identifier_kind   AS identifierKind,
    p.base_symbol       AS baseSymbol,
    p.base_token_address AS baseTokenAddress,
    p.quote_symbol      AS quoteSymbol,
    p.quote_token_address AS quoteTokenAddress,
    p.fee_tier_label    AS feeTierLabel,
    p.pool_created_at   AS poolCreatedAt,
    p.first_seen_at     AS firstSeenAt,
    m.liquidity_usd     AS liquidityUsd,
    m.volume_24h_usd    AS volume24hUsd,
    m.volume_7d_usd     AS volume7dUsd,
    m.price_usd         AS priceUsd,
    m.price_change_24h  AS priceChange24h,
    m.fee_rate          AS feeRate,
    m.fee_source        AS feeSource,
    m.apr_24h           AS apr24h,
    m.apr_7d            AS apr7d,
    m.apr_method        AS aprMethod,
    m.apr_confidence    AS aprConfidence,
    m.apr_reason        AS aprReason,
    m.source            AS source,
    m.updated_at        AS updatedAt,
    m.stale             AS stale,
    t.market_cap_usd    AS marketCapUsd,
    t.fdv_usd           AS fdvUsd,
    t.holders_count     AS holdersCount
  FROM pools p
  JOIN pool_metrics m ON m.pool_key = p.pool_key
  LEFT JOIN tokens t ON t.chain_id = p.chain_id AND t.address = p.base_token_address
`;

function buildWhere(query: PoolQuery): { sql: string; params: Record<string, unknown> } {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  // NULL liquidity is "unknown", not zero, so it must not pass a minimum filter.
  if (query.minLiq !== null && query.minLiq !== undefined) {
    clauses.push(`(m.liquidity_usd IS NOT NULL AND m.liquidity_usd >= @minLiq)`);
    params.minLiq = query.minLiq;
  }
  if (query.minApr !== null && query.minApr !== undefined) {
    clauses.push(`(m.apr_24h IS NOT NULL AND m.apr_24h >= @minApr)`);
    params.minApr = query.minApr;
  }
  if (query.maxAgeHours !== null && query.maxAgeHours !== undefined) {
    clauses.push(
      `(p.pool_created_at IS NOT NULL AND p.pool_created_at >= @createdAfter)`,
    );
    params.createdAfter = new Date(Date.now() - query.maxAgeHours * 3600_000).toISOString();
  }
  if (query.dex) {
    clauses.push(`p.dex_id = @dex`);
    params.dex = query.dex;
  }
  if (query.search) {
    clauses.push(`(
      LOWER(p.base_symbol) LIKE @search
      OR LOWER(p.quote_symbol) LIKE @search
      OR LOWER(p.base_token_address) LIKE @search
      OR LOWER(p.pool_identifier) LIKE @search
    )`);
    params.search = `%${query.search.toLowerCase()}%`;
  }
  if (query.includeStale === false) {
    clauses.push(`m.stale = 0`);
  }

  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function attachFlags(rows: Omit<PoolRow, "flags">[]): PoolRow[] {
  if (rows.length === 0) return [];
  const db = getDb();
  const keys = rows.map((r) => r.poolKey);
  const flags = db
    .prepare(`SELECT pool_key AS poolKey, flag, detail FROM pool_flags WHERE pool_key IN (${keys
      .map(() => "?")
      .join(",")})`)
    .all(...keys) as { poolKey: string; flag: string; detail: string | null }[];

  const byPool = new Map<string, PoolFlag[]>();
  for (const row of flags) {
    const list = byPool.get(row.poolKey) ?? [];
    list.push({ flag: row.flag, detail: row.detail });
    byPool.set(row.poolKey, list);
  }
  return rows.map((row) => ({ ...row, flags: byPool.get(row.poolKey) ?? [] }));
}

export type PoolsPage = {
  rows: PoolRow[];
  total: number;
  page: number;
  limit: number;
  pageCount: number;
  sort: AppliedSort;
  order: "asc" | "desc";
};

export function queryPools(query: PoolQuery = {}): PoolsPage {
  const db = getDb();
  const sortKey: AppliedSort = query.sort && query.sort in SORTABLE
    ? (query.sort as SortKey)
    : "default";
  const order = query.order === "asc" ? "asc" : "desc";
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const { sql: where, params } = buildWhere(query);

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS n FROM pools p JOIN pool_metrics m ON m.pool_key = p.pool_key
              LEFT JOIN tokens t ON t.chain_id = p.chain_id AND t.address = p.base_token_address ${where}`)
    .get(params) as { n: number };

  const direction = order === "asc" ? "ASC" : "DESC";
  const defaultCompleteness = `(
    p.base_symbol IS NULL OR p.quote_symbol IS NULL OR
    t.market_cap_usd IS NULL OR p.pool_created_at IS NULL OR
    m.apr_24h IS NULL OR m.liquidity_usd IS NULL OR m.volume_24h_usd IS NULL
  )`;
  const orderBy = sortKey === "default"
    ? `${defaultCompleteness} ASC,
       (m.volume_24h_usd IS NULL) ASC, m.volume_24h_usd DESC, p.pool_key ASC`
    : `(${SORTABLE[sortKey]} IS NULL) ASC,
       ${SORTABLE[sortKey]} ${direction}, p.pool_key ASC`;
  // The default view prioritizes complete rows, then ranks those rows by 24h
  // volume. Explicit column sorts still keep that column's unknowns last.
  const rows = db
    .prepare(
      `${BASE_SELECT} ${where}
       ORDER BY ${orderBy}
       LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset: (page - 1) * limit }) as Omit<PoolRow, "flags">[];

  const total = totalRow.n;
  return {
    rows: attachFlags(rows),
    total,
    page,
    limit,
    pageCount: Math.max(1, Math.ceil(total / limit)),
    sort: sortKey,
    order,
  };
}

export function getPoolById(publicId: string): PoolRow | null {
  const db = getDb();
  const row = db
    .prepare(`${BASE_SELECT} WHERE p.pool_key = ? OR p.pool_identifier = ?`)
    .get(publicId, publicId.toLowerCase()) as Omit<PoolRow, "flags"> | undefined;
  return row ? attachFlags([row])[0] : null;
}

export function getSnapshots(publicId: string, days = 7) {
  const db = getDb();
  const pool = getPoolById(publicId);
  if (!pool) return [];
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  return db
    .prepare(
      `SELECT captured_at AS capturedAt, liquidity_usd AS liquidityUsd,
              volume_24h_usd AS volume24hUsd, est_apr_24h AS estApr24h
       FROM pool_snapshots WHERE pool_key = ? AND captured_at >= ?
       ORDER BY captured_at ASC`,
    )
    .all(pool.poolKey, since) as {
    capturedAt: string;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    estApr24h: number | null;
  }[];
}

export type Stats = {
  trackedPools: number;
  trackedLiquidityUsd: number | null;
  trackedVolume24hUsd: number | null;
  highestApr: {
    apr24h: number;
    baseSymbol: string | null;
    quoteSymbol: string | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    confidence: string | null;
    poolCreatedAt: string | null;
    poolKey: string;
  } | null;
  poolsWithApr: number;
  poolsWithHolders: number;
  poolsWithMcap: number;
  poolsWithLiquidity: number;
  dexes: { id: string; pools: number }[];
  updatedAt: string | null;
  stalePools: number;
  chainId: number;
};

export function getStats(): Stats {
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS pools,
         SUM(m.liquidity_usd) AS liquidity,
         SUM(m.volume_24h_usd) AS volume24h,
         SUM(CASE WHEN m.apr_24h IS NOT NULL THEN 1 ELSE 0 END) AS withApr,
         SUM(CASE WHEN t.holders_count IS NOT NULL THEN 1 ELSE 0 END) AS withHolders,
         SUM(CASE WHEN t.market_cap_usd IS NOT NULL THEN 1 ELSE 0 END) AS withMcap,
         SUM(CASE WHEN m.liquidity_usd IS NOT NULL THEN 1 ELSE 0 END) AS withLiquidity,
         SUM(CASE WHEN m.stale = 1 THEN 1 ELSE 0 END) AS stale,
         MAX(m.updated_at) AS updatedAt
       FROM pools p
       JOIN pool_metrics m ON m.pool_key = p.pool_key
       LEFT JOIN tokens t ON t.chain_id = p.chain_id AND t.address = p.base_token_address`,
    )
    .get() as {
      pools: number;
      liquidity: number | null;
      volume24h: number | null;
      withApr: number | null;
      withHolders: number | null;
      withMcap: number | null;
      withLiquidity: number | null;
      stale: number | null;
      updatedAt: string | null;
    };

  // A headline APR is only honest next to its scale and its data window, so both
  // travel with it into the UI.
  const best = db
    .prepare(
      `SELECT m.apr_24h AS apr24h, p.base_symbol AS baseSymbol, p.quote_symbol AS quoteSymbol,
              m.liquidity_usd AS liquidityUsd, m.volume_24h_usd AS volume24hUsd,
              m.apr_confidence AS confidence, p.pool_created_at AS poolCreatedAt,
              p.pool_key AS poolKey
       FROM pools p JOIN pool_metrics m ON m.pool_key = p.pool_key
       WHERE m.apr_24h IS NOT NULL AND m.apr_confidence != 'na'
         AND m.liquidity_usd >= ${DEFAULT_MIN_LIQ_USD}
       ORDER BY m.apr_24h DESC LIMIT 1`,
    )
    .get() as Stats["highestApr"];

  const dexes = db
    .prepare(
      `SELECT dex_id AS id, COUNT(*) AS pools FROM pools GROUP BY dex_id ORDER BY pools DESC`,
    )
    .all() as { id: string; pools: number }[];

  return {
    trackedPools: Number(totals.pools ?? 0),
    trackedLiquidityUsd: totals.liquidity ?? null,
    trackedVolume24hUsd: totals.volume24h ?? null,
    highestApr: best ?? null,
    poolsWithApr: Number(totals.withApr ?? 0),
    poolsWithHolders: Number(totals.withHolders ?? 0),
    poolsWithMcap: Number(totals.withMcap ?? 0),
    poolsWithLiquidity: Number(totals.withLiquidity ?? 0),
    stalePools: Number(totals.stale ?? 0),
    dexes,
    updatedAt: totals.updatedAt ?? null,
    chainId: 5042,
  };
}

export function getSyncStatus() {
  const db = getDb();
  return db
    .prepare(`SELECT job_name AS jobName, status, last_success_at AS lastSuccessAt, last_error AS lastError, stats_json AS statsJson FROM sync_jobs`)
    .all() as {
    jobName: string;
    status: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    statsJson: string | null;
  }[];
}

/** Age is computed live from creation time on the client, per the refresh table. */
export function ageFrom(createdAt: string | null, now = Date.now()): number | null {
  if (!createdAt) return null;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return null;
  return Math.max(0, now - created);
}
