/**
 * Sync pipeline: Discover → Normalize → Enrich → Calculate → Validate → Upsert.
 *
 * Design rules that come straight from the PRD:
 *  - a source failure never destroys the last good data (Stale, not blank);
 *  - cross-source conflicts are flagged, never silently overwritten;
 *  - pools missing from a sync are kept (with stale=1) instead of deleted, so a
 *    flaky upstream can't wipe the leaderboard.
 */
import { getDb } from "./db";
import { computeApr24h, computeApr7d } from "./apr";
import { sanitizeValuation } from "./valuation";
import {
  fetchPoolsPage,
  fetchPoolDetail,
  fetchTokenMetadata,
  GT_MAX_PAGE,
} from "./sources/geckoterminal";
import { discoverPools, fetchToken } from "./sources/dexpaprika";
import { fetchDexScreenerMetrics } from "./sources/dexscreener";
import { fetchCmcHolderCount, fetchCmcMarketCap } from "./sources/coinmarketcap";
import { fetchTokenSymbol } from "./sources/arc-rpc";
import { poolKeyOf, type DiscoveredPool, type PoolFlag } from "./types";

export type SyncOptions = {
  maxPages?: number;
  /** First page fetched this run; rotates by default to stay inside quota. */
  startPage?: number;
  /** How many top-liquidity pools get an exact fee via the detail endpoint. */
  detailBudget?: number;
  /** Token metadata lookups for pools discovered without symbols. */
  tokenBudget?: number;
  /** Page cap for the DexPaprika cross-check pass. */
  crossCheck?: boolean;
  /** Number of base tokens enriched through CMC's keyless public DEX API. */
  cmcTokenBudget?: number;
  /** On-chain symbol lookups after both indexer sources miss. */
  rpcTokenBudget?: number;
  now?: Date;
};

export type SyncResult = {
  discovered: number;
  upserted: number;
  flagged: number;
  pagesFetched: number;
  startPage: number;
  detailCalls: number;
  gtTokenCalls: number;
  dpTokenCalls: number;
  rpcTokenCalls: number;
  tokensUnresolved: number;
  crossCheck: { pools: number; error: string | null; truncated: boolean };
  dexScreener: DexScreenerRefreshResult;
  missingVolume: MissingVolumeRefreshResult;
  coinMarketCap: CoinMarketCapRefreshResult;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
};

const DEFAULTS = {
  /*
   * Pages fetched per run. With rotation this is how many of the 10 available
   * pages each tick covers; the default of 3 refreshes the whole list roughly
   * every 30 minutes, which is what the keyless quota actually sustains
   * (measured: a 10-page crawl back-to-back ends in a hard 429). Raise it once
   * a free API key is configured.
   */
  maxPages: Number(process.env.SYNC_PAGES ?? 3),
  detailBudget: Number(process.env.SYNC_DETAIL_BUDGET ?? 30),
  tokenBudget: Number(process.env.SYNC_TOKEN_BUDGET ?? 40),
  crossCheck: process.env.SYNC_CROSS_CHECK !== "false",
  cmcTokenBudget: Number(process.env.SYNC_CMC_TOKEN_BUDGET ?? 20),
  rpcTokenBudget: Number(process.env.SYNC_RPC_TOKEN_BUDGET ?? 40),
};

/**
 * Deterministic page rotation: the same wall-clock window always yields the same
 * start page, so concurrent runs do not collide on one slice, and a full cycle
 * walks every page within `maxPages` runs. This is what keeps the collector
 * inside GeckoTerminal's keyless quota instead of burning it on every tick.
 */
export function rotatingStartPage(maxPages: number, now: Date, windowMs = 10 * 60_000): number {
  if (maxPages <= 1) return 1;
  return (Math.floor(now.getTime() / windowMs) % maxPages) + 1;
}

export function syncStartPage(now: Date): number {
  return rotatingStartPage(GT_MAX_PAGE, now);
}

/**
 * How old a pool's own data may get before the row is shown as stale. Comfortably
 * longer than the rotation cycle so a pool is not flagged between its own visits.
 */
const STALE_AFTER_MS = Number(process.env.SYNC_STALE_AFTER_MS ?? 60 * 60_000);

/** Relative disagreement above which two sources are considered to conflict. */
const LIQ_CONFLICT_THRESHOLD = 0.25;

export type DexScreenerRefreshResult = {
  requests: number;
  matched: number;
  updated: number;
  filledLiquidity: number;
  filledVolume24h: number;
  marketCapsUpdated: number;
  identitiesUpdated: number;
  refreshedStale: number;
  errors: string[];
};

export type MissingVolumeRefreshResult = {
  attempted: number;
  updated: number;
  errors: string[];
};

export type CoinMarketCapRefreshResult = {
  attempted: number;
  marketCapsUpdated: number;
  holdersUpdated: number;
  errors: string[];
};

const CMC_REFRESH_MS = 24 * 60 * 60_000;
const FEE_RECHECK_MS = 24 * 60 * 60_000;

/**
 * Fill token MCAP and holder counts from CMC's documented keyless DEX API.
 * Missing values are prioritized by pool liquidity and refreshed gradually so
 * the shared public rate pool is not hammered by a full token crawl.
 */
export async function refreshKnownTokensFromCoinMarketCap(
  now = new Date(),
  budget = DEFAULTS.cmcTokenBudget,
): Promise<CoinMarketCapRefreshResult> {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - CMC_REFRESH_MS).toISOString();
  const candidates = db
    .prepare(
      `SELECT p.base_token_address AS address,
              t.market_cap_usd AS marketCapUsd,
              t.market_cap_checked_at AS marketCapCheckedAt,
              t.fdv_usd AS fdvUsd,
              t.holders_count AS holdersCount,
              t.holders_updated_at AS holdersUpdatedAt,
              t.holders_checked_at AS holdersCheckedAt,
              EXISTS(
                SELECT 1 FROM pools fp
                JOIN pool_flags ff ON ff.pool_key = fp.pool_key
                WHERE fp.chain_id = p.chain_id
                  AND fp.base_token_address = p.base_token_address
                  AND ff.flag = 'mcap_estimated_cmc'
              ) AS marketCapFromCmc,
              MAX(m.liquidity_usd) AS maxLiquidity
       FROM pools p
       JOIN pool_metrics m ON m.pool_key = p.pool_key
       JOIN tokens t ON t.chain_id = p.chain_id AND t.address = p.base_token_address
       WHERE p.chain_id = 5042
         AND p.base_token_address GLOB '0x[0-9a-fA-F]*'
         AND length(p.base_token_address) = 42
         AND p.base_token_address NOT LIKE '0x0000%'
       GROUP BY p.base_token_address
       ORDER BY maxLiquidity DESC,
                (t.holders_count IS NULL) DESC,
                (t.market_cap_usd IS NULL) DESC`,
    )
    .all() as {
    address: string;
    marketCapUsd: number | null;
    marketCapCheckedAt: string | null;
    fdvUsd: number | null;
    holdersCount: number | null;
    holdersUpdatedAt: string | null;
    holdersCheckedAt: string | null;
    marketCapFromCmc: number;
    maxLiquidity: number | null;
  }[];
  const tokens = candidates
    .filter((token) => {
      const marketCapLastChecked = token.marketCapCheckedAt ?? token.holdersUpdatedAt;
      const holdersLastChecked = token.holdersCheckedAt ?? token.holdersUpdatedAt;
      const marketCapDue =
        (token.marketCapUsd === null || token.marketCapFromCmc === 1) &&
        (marketCapLastChecked === null || marketCapLastChecked < staleBefore);
      const holdersDue = holdersLastChecked === null || holdersLastChecked < staleBefore;
      return marketCapDue || holdersDue;
    })
    .slice(0, Math.max(0, budget));

  const result: CoinMarketCapRefreshResult = {
    attempted: 0,
    marketCapsUpdated: 0,
    holdersUpdated: 0,
    errors: [],
  };
  const updateToken = db.prepare(`
    UPDATE tokens SET
      market_cap_usd = COALESCE(@marketCapUsd, market_cap_usd),
      market_cap_checked_at = COALESCE(@marketCapCheckedAt, market_cap_checked_at),
      holders_count = COALESCE(@holdersCount, holders_count),
      holders_updated_at = CASE
        WHEN @holdersCount IS NOT NULL THEN @holdersUpdatedAt
        ELSE holders_updated_at
      END,
      holders_checked_at = COALESCE(@holdersCheckedAt, holders_checked_at)
    WHERE chain_id = 5042 AND address = @address
  `);
  const poolsForToken = db.prepare(
    "SELECT pool_key AS poolKey FROM pools WHERE chain_id = 5042 AND base_token_address = ?",
  );
  const insertFlag = db.prepare(
    "INSERT OR REPLACE INTO pool_flags (pool_key, flag, detail) VALUES (?, ?, ?)",
  );

  for (const token of tokens) {
    result.attempted++;
    let marketCapUsd: number | null = null;
    let marketCapCheckedAt: string | null = null;
    let holdersCount: number | null = null;
    let holdersUpdatedAt: string | null = null;
    let holdersCheckedAt: string | null = null;
    let rateLimited = false;
    const marketCapLastChecked = token.marketCapCheckedAt ?? token.holdersUpdatedAt;
    const holdersLastChecked = token.holdersCheckedAt ?? token.holdersUpdatedAt;
    const marketCapDue =
      (token.marketCapUsd === null || token.marketCapFromCmc === 1) &&
      (marketCapLastChecked === null || marketCapLastChecked < staleBefore);
    const holdersDue = holdersLastChecked === null || holdersLastChecked < staleBefore;

    if (marketCapDue) {
      try {
        const response = await fetchCmcMarketCap(token.address);
        const reported = response.marketCapUsd;
        marketCapUsd = sanitizeValuation(reported, token.fdvUsd).marketCapUsd;
        marketCapCheckedAt = response.fetchedAt;
      } catch (error) {
        result.errors.push(
          `${token.address} MCAP: ${error instanceof Error ? error.message : String(error)}`,
        );
        rateLimited = String(error).includes("429");
      }
    }
    if (holdersDue && !rateLimited) {
      try {
        const holders = await fetchCmcHolderCount(token.address);
        holdersCount = holders.holdersCount;
        holdersCheckedAt = holders.fetchedAt;
        holdersUpdatedAt = holdersCount === null ? null : holders.fetchedAt;
      } catch (error) {
        result.errors.push(
          `${token.address} holders: ${error instanceof Error ? error.message : String(error)}`,
        );
        rateLimited = String(error).includes("429");
      }
    }

    if (marketCapCheckedAt !== null || holdersCheckedAt !== null) {
      updateToken.run({
        address: token.address,
        marketCapUsd,
        marketCapCheckedAt,
        holdersCount,
        holdersUpdatedAt,
        holdersCheckedAt,
      });
    }
    if (marketCapUsd !== null) result.marketCapsUpdated++;
    if (holdersCount !== null) result.holdersUpdated++;

    const poolRows = poolsForToken.all(token.address) as { poolKey: string }[];
    for (const pool of poolRows) {
      if (marketCapUsd !== null) {
        insertFlag.run(
          pool.poolKey,
          "mcap_estimated_cmc",
          "CoinMarketCap's DEX token endpoint reports this market cap. Arc circulating supply is not independently verified, so treat it as an estimate.",
        );
      }
      if (holdersCount !== null) {
        insertFlag.run(
          pool.poolKey,
          "holders_cmc",
          "Base-token holder count from CoinMarketCap's keyless public DEX endpoint.",
        );
      }
    }
    // A shared keyless 429 should end this pass; a later sync resumes at the
    // first unchecked token without losing a successful partial update.
    if (rateLimited) break;
  }
  return result;
}

function recordJob(
  job: string,
  status: string,
  fields: { lastError?: string | null; stats?: unknown; nextRunAt?: string | null } = {},
) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_jobs (job_name, status, last_success_at, last_error, next_run_at, stats_json)
     VALUES (@job, @status, @success, @error, @next, @stats)
     ON CONFLICT(job_name) DO UPDATE SET
       status = excluded.status,
       last_success_at = COALESCE(excluded.last_success_at, sync_jobs.last_success_at),
       last_error = excluded.last_error,
       next_run_at = excluded.next_run_at,
       stats_json = excluded.stats_json`,
  ).run({
    job,
    status,
    success: status === "success" ? now : null,
    error: fields.lastError ?? null,
    next: fields.nextRunAt ?? null,
    stats: fields.stats ? JSON.stringify(fields.stats) : null,
  });
}

function averageLiquidityOver7d(poolKey: string, now: Date): { avg: number | null; samples: number } {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT AVG(liquidity_usd) AS avg, COUNT(*) AS samples
       FROM pool_snapshots
       WHERE pool_key = ? AND captured_at >= ? AND liquidity_usd IS NOT NULL`,
    )
    .get(poolKey, since) as { avg: number | null; samples: number };
  return { avg: rows.avg ?? null, samples: rows.samples ?? 0 };
}

/** Anomaly detection for the live Arc data: dust pools and volume with no liquidity. */
function detectFlags(pool: DiscoveredPool): PoolFlag[] {
  const flags: PoolFlag[] = [];
  const liq = pool.liquidityUsd;
  const vol = pool.volume24hUsd;

  if (liq !== null && liq <= 0) {
    flags.push({
      flag: "zero_liquidity",
      detail: "Upstream reports zero liquidity while volume is non-zero; treat metrics as unreliable.",
    });
  }
  if (liq !== null && liq < 1000 && (vol ?? 0) > 0) {
    flags.push({
      flag: "dust_liquidity",
      detail: `Liquidity under $1K with ${vol ? `$${Math.round(vol).toLocaleString("en-US")}` : "volume"} in 24h — likely a wash-traded or abandoned pool.`,
    });
  }
  // A spectacular APR on a tiny pool is the single most misleading number a
  // leaderboard can print. Measured live: Arc's top APR rows were all ~$10K
  // pools quoting 1,000–3,000%, which is wash-trading far more often than yield.
  if (
    liq !== null &&
    liq > 0 &&
    liq < 50_000 &&
    vol !== null &&
    pool.feeRate !== null &&
    (vol * pool.feeRate * 365 * 100) / liq > 500
  ) {
    flags.push({
      flag: "high_apr_low_liq",
      detail: `Headline APR on only ${Math.round(liq).toLocaleString("en-US")} USD of liquidity — treat as a size/wash-trading warning, not an opportunity.`,
    });
  }
  if (liq !== null && liq > 0 && vol !== null && vol / liq > 1000) {
    flags.push({
      flag: "extreme_volume_ratio",
      detail: `24h volume is ${Math.round(vol / liq).toLocaleString("en-US")}× liquidity — inflated APR risk.`,
    });
  }
  if (!pool.baseTokenAddress) {
    flags.push({
      flag: "token_unidentified",
      detail:
        "One side of this pair has no identifiable token contract upstream (DexPaprika reports a placeholder address for it), so the pair is shown without a name.",
    });
  }
  if (!pool.baseSymbol || !pool.quoteSymbol) {
    flags.push({
      flag: "symbol_pending",
      detail:
        "Token symbol is not yet resolved for this pair; the address is shown instead. Upstream rate limits the metadata lookup.",
    });
  }
  if (!pool.poolCreatedAt) {
    flags.push({ flag: "unknown_created_at", detail: "Pool creation time unavailable upstream; AGE shows N/A." });
  }
  if (pool.feeSource === "pool_name") {
    flags.push({ flag: "fee_from_name", detail: "Fee parsed from the pool name; treat APR as approximate." });
  }
  if (pool.feeSource === "unknown") {
    flags.push({ flag: "fee_unknown", detail: "No verifiable fee rate; APR shows N/A." });
  }
  return flags;
}

/**
 * Refresh known pools through DexScreener without changing discovery or source
 * precedence. Fresh primary metrics are never overwritten: DexScreener only
 * fills a missing field or replaces a row that has already aged into `stale`.
 */
export async function refreshKnownPoolsFromDexScreener(
  now = new Date(),
): Promise<DexScreenerRefreshResult> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.pool_key AS poolKey, p.pool_identifier AS poolIdentifier,
              p.base_symbol AS baseSymbol, p.quote_symbol AS quoteSymbol,
              p.base_token_address AS baseTokenAddress,
              p.quote_token_address AS quoteTokenAddress,
              p.pool_created_at AS poolCreatedAt,
              m.liquidity_usd AS liquidityUsd, m.volume_24h_usd AS volume24hUsd,
              m.price_usd AS priceUsd, m.price_change_24h AS priceChange24h,
              m.fee_rate AS feeRate, m.fee_source AS feeSource,
              m.source, m.updated_at AS updatedAt, m.stale,
              t.market_cap_usd AS marketCapUsd, t.fdv_usd AS fdvUsd,
              EXISTS(
                SELECT 1 FROM pool_flags pf
                WHERE pf.pool_key = p.pool_key AND pf.flag = 'mcap_estimated_dexscreener'
              ) AS marketCapFromDexScreener
       FROM pools p
       JOIN pool_metrics m ON m.pool_key = p.pool_key
       LEFT JOIN tokens t ON t.chain_id = p.chain_id AND t.address = p.base_token_address`,
    )
    .all() as {
    poolKey: string;
    poolIdentifier: string;
    baseSymbol: string | null;
    quoteSymbol: string | null;
    baseTokenAddress: string | null;
    quoteTokenAddress: string | null;
    poolCreatedAt: string | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
    priceUsd: number | null;
    priceChange24h: number | null;
    feeRate: number | null;
    feeSource: string | null;
    source: string;
    updatedAt: string;
    stale: number;
    marketCapUsd: number | null;
    fdvUsd: number | null;
    marketCapFromDexScreener: number;
  }[];

  const fetched = await fetchDexScreenerMetrics(rows.map((row) => row.poolIdentifier));
  const result: DexScreenerRefreshResult = {
    requests: fetched.requests,
    matched: fetched.metrics.size,
    updated: 0,
    filledLiquidity: 0,
    filledVolume24h: 0,
    marketCapsUpdated: 0,
    identitiesUpdated: 0,
    refreshedStale: 0,
    errors: fetched.errors,
  };
  const staleCutoff = now.getTime() - STALE_AFTER_MS;

  const updatePoolCreatedAt = db.prepare(
    `UPDATE pools SET pool_created_at = ? WHERE pool_key = ? AND pool_created_at IS NULL`,
  );
  const updatePoolIdentity = db.prepare(`
    UPDATE pools SET
      base_symbol = @baseSymbol,
      base_token_address = @baseTokenAddress,
      quote_symbol = @quoteSymbol,
      quote_token_address = @quoteTokenAddress
    WHERE pool_key = @poolKey
  `);
  const upsertTokenIdentity = db.prepare(`
    INSERT INTO tokens (chain_id, address, name, symbol)
    VALUES (5042, @address, @name, @symbol)
    ON CONFLICT(chain_id, address) DO UPDATE SET
      name = COALESCE(excluded.name, tokens.name),
      symbol = COALESCE(excluded.symbol, tokens.symbol)
  `);
  const updateMetrics = db.prepare(`
    UPDATE pool_metrics SET
      liquidity_usd = @liquidityUsd,
      volume_24h_usd = @volume24hUsd,
      price_usd = @priceUsd,
      price_change_24h = @priceChange24h,
      apr_24h = @apr24h,
      apr_method = @aprMethod,
      apr_confidence = @aprConfidence,
      apr_reason = @aprReason,
      source = @source,
      updated_at = @updatedAt,
      stale = 0
    WHERE pool_key = @poolKey
  `);
  const insertSnapshot = db.prepare(`
    INSERT OR REPLACE INTO pool_snapshots
      (pool_key, captured_at, liquidity_usd, volume_24h_usd, est_apr_24h)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertFlag = db.prepare(
    `INSERT OR REPLACE INTO pool_flags (pool_key, flag, detail) VALUES (?, ?, ?)`,
  );
  const updateTokenValuation = db.prepare(`
    UPDATE tokens SET
      market_cap_usd = @marketCapUsd,
      market_cap_checked_at = @checkedAt,
      fdv_usd = COALESCE(@fdvUsd, fdv_usd)
    WHERE chain_id = 5042 AND address = @address
  `);
  const poolsForToken = db.prepare(
    "SELECT pool_key AS poolKey FROM pools WHERE chain_id = 5042 AND base_token_address = ?",
  );
  const clearCarried = db.prepare(
    `DELETE FROM pool_flags WHERE pool_key = ? AND flag = 'metric_carried'`,
  );
  const clearIdentityFlags = db.prepare(
    `DELETE FROM pool_flags WHERE pool_key = ? AND flag IN ('symbol_pending', 'token_unidentified')`,
  );

  const valuedTokens = new Set<string>();
  const write = db.transaction(() => {
    for (const row of rows) {
      const incoming = fetched.metrics.get(row.poolIdentifier.toLowerCase());
      if (!incoming) continue;

      const hasIdentity =
        incoming.baseTokenAddress &&
        incoming.baseTokenSymbol &&
        incoming.quoteTokenAddress &&
        incoming.quoteTokenSymbol;
      const identityChanged =
        hasIdentity &&
        (row.baseSymbol !== incoming.baseTokenSymbol ||
          row.quoteSymbol !== incoming.quoteTokenSymbol ||
          row.baseTokenAddress?.toLowerCase() !== incoming.baseTokenAddress ||
          row.quoteTokenAddress?.toLowerCase() !== incoming.quoteTokenAddress);
      if (identityChanged) {
        updatePoolIdentity.run({
          poolKey: row.poolKey,
          baseSymbol: incoming.baseTokenSymbol,
          baseTokenAddress: incoming.baseTokenAddress,
          quoteSymbol: incoming.quoteTokenSymbol,
          quoteTokenAddress: incoming.quoteTokenAddress,
        });
        upsertTokenIdentity.run({
          address: incoming.baseTokenAddress,
          name: incoming.baseTokenName,
          symbol: incoming.baseTokenSymbol,
        });
        upsertTokenIdentity.run({
          address: incoming.quoteTokenAddress,
          name: incoming.quoteTokenName,
          symbol: incoming.quoteTokenSymbol,
        });
        clearIdentityFlags.run(row.poolKey);
        result.identitiesUpdated++;
      }

      if (!row.poolCreatedAt && incoming.poolCreatedAt) {
        updatePoolCreatedAt.run(incoming.poolCreatedAt, row.poolKey);
      }

      const baseTokenAddress = hasIdentity
        ? incoming.baseTokenAddress
        : row.baseTokenAddress?.toLowerCase() ?? null;
      if (
        baseTokenAddress &&
        baseTokenAddress === incoming.baseTokenAddress &&
        !valuedTokens.has(baseTokenAddress) &&
        (row.marketCapUsd === null || row.marketCapFromDexScreener === 1)
      ) {
        valuedTokens.add(baseTokenAddress);
        const valuation = sanitizeValuation(
          incoming.marketCapUsd,
          incoming.fdvUsd ?? row.fdvUsd,
        );
        if (valuation.marketCapUsd !== null) {
          updateTokenValuation.run({
            address: baseTokenAddress,
            marketCapUsd: valuation.marketCapUsd,
            fdvUsd: valuation.fdvUsd,
            checkedAt: incoming.updatedAt,
          });
          result.marketCapsUpdated++;
          const tokenPools = poolsForToken.all(baseTokenAddress) as { poolKey: string }[];
          for (const pool of tokenPools) {
            insertFlag.run(
              pool.poolKey,
              "mcap_estimated_dexscreener",
              "DexScreener reports this market cap, but Arc circulating supply is not independently verified, so treat it as an estimate.",
            );
          }
        }
      }

      const aged = Date.parse(row.updatedAt) < staleCutoff;
      const isStale = row.stale === 1 || aged;
      const hasCompleteMarketMetrics =
        incoming.liquidityUsd !== null && incoming.volume24hUsd !== null;

      if (!isStale && row.liquidityUsd && incoming.liquidityUsd) {
        const drift =
          Math.abs(row.liquidityUsd - incoming.liquidityUsd) /
          Math.max(row.liquidityUsd, incoming.liquidityUsd);
        if (drift > LIQ_CONFLICT_THRESHOLD) {
          insertFlag.run(
            row.poolKey,
            "source_conflict",
            "Fresh primary liquidity and DexScreener differ by more than 25%; the primary value is kept.",
          );
        }
      }

      const nextLiquidity = isStale
        ? (incoming.liquidityUsd ?? row.liquidityUsd)
        : (row.liquidityUsd ?? incoming.liquidityUsd);
      const nextVolume24h = isStale
        ? (incoming.volume24hUsd ?? row.volume24hUsd)
        : (row.volume24hUsd ?? incoming.volume24hUsd);
      const nextPrice = isStale
        ? (incoming.priceUsd ?? row.priceUsd)
        : (row.priceUsd ?? incoming.priceUsd);
      const nextPriceChange = isStale
        ? (incoming.priceChange24h ?? row.priceChange24h)
        : (row.priceChange24h ?? incoming.priceChange24h);

      const filledLiquidity = row.liquidityUsd === null && incoming.liquidityUsd !== null;
      const filledVolume = row.volume24hUsd === null && incoming.volume24hUsd !== null;
      const filledPrice = row.priceUsd === null && incoming.priceUsd !== null;
      // `stale` is row-level, so clearing it is only honest when both core
      // market fields were refreshed together. A fresh row may still accept a
      // single missing field without changing the already-current values.
      const applied = isStale
        ? hasCompleteMarketMetrics
        : filledLiquidity || filledVolume || filledPrice;
      if (!applied) continue;

      const apr = computeApr24h({
        volume24hUsd: nextVolume24h,
        liquidityUsd: nextLiquidity,
        feeRate: row.feeRate,
        feeSource:
          row.feeSource === "detail_api" || row.feeSource === "pool_name"
            ? row.feeSource
            : "unknown",
        poolCreatedAt: row.poolCreatedAt ?? incoming.poolCreatedAt,
        now,
      });
      const source = row.source.includes("dexscreener")
        ? row.source
        : `${row.source}+dexscreener`;

      updateMetrics.run({
        poolKey: row.poolKey,
        liquidityUsd: nextLiquidity,
        volume24hUsd: nextVolume24h,
        priceUsd: nextPrice,
        priceChange24h: nextPriceChange,
        apr24h: apr.apr24h,
        aprMethod: apr.method,
        aprConfidence: apr.confidence,
        aprReason: apr.reason,
        source,
        updatedAt: incoming.updatedAt,
      });
      insertSnapshot.run(
        row.poolKey,
        incoming.updatedAt,
        nextLiquidity,
        nextVolume24h,
        apr.apr24h,
      );
      clearCarried.run(row.poolKey);
      insertFlag.run(
        row.poolKey,
        "dexscreener_fallback",
        isStale
          ? "Primary metrics were stale, so current liquidity and 24h volume were refreshed from DexScreener."
          : "A missing primary metric was filled from DexScreener; fresh primary values were kept.",
      );

      result.updated++;
      if (filledLiquidity) result.filledLiquidity++;
      if (filledVolume) result.filledVolume24h++;
      if (isStale) result.refreshedStale++;
    }
  });
  write();
  return result;
}

/**
 * Recover the small set of known address pools whose 24h volume is still
 * missing after the bulk sources. The GeckoTerminal detail endpoint is slower,
 * so this path is deliberately capped and only spends calls on actual gaps.
 */
export async function refreshMissingVolumesFromGeckoTerminal(
  now = new Date(),
  budget = Number(process.env.MISSING_VOLUME_DETAIL_BUDGET ?? 5),
): Promise<MissingVolumeRefreshResult> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.pool_key AS poolKey, p.pool_identifier AS poolIdentifier,
              p.pool_created_at AS poolCreatedAt,
              m.liquidity_usd AS liquidityUsd, m.fee_rate AS feeRate,
              m.fee_source AS feeSource, m.source, m.stale
       FROM pools p JOIN pool_metrics m ON m.pool_key = p.pool_key
       WHERE m.volume_24h_usd IS NULL AND p.identifier_kind = 'address'
       ORDER BY m.liquidity_usd DESC
       LIMIT ?`,
    )
    .all(Math.max(0, budget)) as {
    poolKey: string;
    poolIdentifier: string;
    poolCreatedAt: string | null;
    liquidityUsd: number | null;
    feeRate: number | null;
    feeSource: string | null;
    source: string;
    stale: number;
  }[];

  const result: MissingVolumeRefreshResult = { attempted: 0, updated: 0, errors: [] };
  const updatePoolCreatedAt = db.prepare(
    `UPDATE pools SET pool_created_at = ? WHERE pool_key = ? AND pool_created_at IS NULL`,
  );
  const updateMetrics = db.prepare(`
    UPDATE pool_metrics SET
      liquidity_usd = @liquidityUsd,
      volume_24h_usd = @volume24hUsd,
      fee_rate = @feeRate,
      fee_source = @feeSource,
      apr_24h = @apr24h,
      apr_method = @aprMethod,
      apr_confidence = @aprConfidence,
      apr_reason = @aprReason,
      source = @source,
      updated_at = @updatedAt,
      stale = @stale
    WHERE pool_key = @poolKey
  `);
  const insertSnapshot = db.prepare(`
    INSERT OR REPLACE INTO pool_snapshots
      (pool_key, captured_at, liquidity_usd, volume_24h_usd, est_apr_24h)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertFlag = db.prepare(
    `INSERT OR REPLACE INTO pool_flags (pool_key, flag, detail) VALUES (?, ?, ?)`,
  );
  const clearCarried = db.prepare(
    `DELETE FROM pool_flags WHERE pool_key = ? AND flag = 'metric_carried'`,
  );

  for (const row of rows) {
    result.attempted++;
    try {
      const detail = await fetchPoolDetail(row.poolIdentifier);
      if (!detail?.volume24hUsd) continue;

      const liquidityUsd = row.liquidityUsd ?? detail.liquidityUsd;
      const feeRate = detail.feeRate ?? row.feeRate;
      const feeSource = detail.feeRate
        ? "detail_api"
        : row.feeSource === "detail_api" || row.feeSource === "pool_name"
          ? row.feeSource
          : "unknown";
      const poolCreatedAt = row.poolCreatedAt ?? detail.poolCreatedAt;
      const apr = computeApr24h({
        volume24hUsd: detail.volume24hUsd,
        liquidityUsd,
        feeRate,
        feeSource,
        poolCreatedAt,
        now,
      });
      const source = row.source.includes("geckoterminal_detail")
        ? row.source
        : `${row.source}+geckoterminal_detail`;

      db.transaction(() => {
        if (!row.poolCreatedAt && detail.poolCreatedAt) {
          updatePoolCreatedAt.run(detail.poolCreatedAt, row.poolKey);
        }
        updateMetrics.run({
          poolKey: row.poolKey,
          liquidityUsd,
          volume24hUsd: detail.volume24hUsd,
          feeRate,
          feeSource,
          apr24h: apr.apr24h,
          aprMethod: apr.method,
          aprConfidence: apr.confidence,
          aprReason: apr.reason,
          source,
          updatedAt: detail.updatedAt,
          stale: liquidityUsd === null ? row.stale : 0,
        });
        insertSnapshot.run(
          row.poolKey,
          detail.updatedAt,
          liquidityUsd,
          detail.volume24hUsd,
          apr.apr24h,
        );
        clearCarried.run(row.poolKey);
        insertFlag.run(
          row.poolKey,
          "geckoterminal_detail_fallback",
          "Missing 24h volume was recovered from the GeckoTerminal pool detail endpoint.",
        );
      })();
      result.updated++;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      break;
    }
  }

  return result;
}

export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const maxPages = Math.min(options.maxPages ?? DEFAULTS.maxPages, GT_MAX_PAGE);
  const detailBudget = options.detailBudget ?? DEFAULTS.detailBudget;
  const tokenBudget = options.tokenBudget ?? DEFAULTS.tokenBudget;
  const rpcTokenBudget = options.rpcTokenBudget ?? DEFAULTS.rpcTokenBudget;
  const now = options.now ?? new Date();
  // Rotating start page keeps each run inside GeckoTerminal's keyless quota:
  // a full 10-page crawl on every tick exceeds it and ends in a hard 429.
  // `maxPages` is the number of pages fetched per run, not the size of the
  // rotation. The upstream exposes ten pages, so a three-page budget must
  // still move across all ten instead of repeating pages 1–3 forever.
  const startPage = options.startPage ?? syncStartPage(now);
  const startedAt = now.toISOString();
  const warnings: string[] = [];
  /** Pool keys where two sources disagree on liquidity beyond the threshold. */
  const conflictedKeys = new Set<string>();
  /** v4 pools reached through more than one wrapper label. */
  const wrappedKeys = new Map<string, string[]>();
  /** Pools whose fee rate was reused from an earlier sync (quota was exhausted). */
  const retainedFeeKeys = new Set<string>();
  /** Pools where a metric was carried forward from the last successful sync. */
  const carriedKeys = new Set<string>();

  recordJob("pools_sync", "running");

  // ---- Discover + Normalize (GeckoTerminal primary) ----
  const merged = new Map<string, DiscoveredPool>();
  let pagesFetched = 0;
  let cursor = startPage;

  try {
    while (pagesFetched < maxPages) {
      const result = await fetchPoolsPage(cursor);
      pagesFetched++;
      for (const pool of result.pools) {
        const key = poolKeyOf(pool);
        const existing = merged.get(key);
        merged.set(key, mergePool(existing, pool));
      }
      cursor = cursor >= GT_MAX_PAGE ? 1 : cursor + 1;
      // A short page is the real end of the list; nothing beyond it exists.
      if (!result.hasMore) break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordJob("pools_sync", "failed", { lastError: message });
    warnings.push(`Primary source failed after ${pagesFetched} page(s): ${message}`);
  }

  // ---- Cross-check with DexPaprika (7d volume, creation time) ----
  let crossCheck: SyncResult["crossCheck"] = { pools: 0, error: null, truncated: false };
  if (options.crossCheck ?? DEFAULTS.crossCheck) {
    const result = await discoverPools();
    crossCheck = { pools: result.pools.length, error: result.error, truncated: result.truncated };
    for (const dp of result.pools) {
      const key = poolKeyOf(dp);
      const existing = merged.get(key);
      if (existing) {
        merged.set(key, mergePool(existing, dp));
        if (
          existing.liquidityUsd &&
          dp.liquidityUsd &&
          Math.abs(existing.liquidityUsd - dp.liquidityUsd) / Math.max(existing.liquidityUsd, dp.liquidityUsd) >
            LIQ_CONFLICT_THRESHOLD
        ) {
          conflictedKeys.add(key);
        }
        // Same bytes32 Pool ID seen under two wrapper labels => one pool, two labels.
        if (existing.dexId !== dp.dexId) {
          wrappedKeys.set(key, [...(wrappedKeys.get(key) ?? []), dp.dexId]);
        }
      } else {
        merged.set(key, dp);
      }
    }
    if (result.error) warnings.push(`Cross-check source unavailable: ${result.error}`);
    if (result.truncated) warnings.push("DexPaprika discovery was truncated by the configured page budget.");
  }

  // Incomplete rows must remain eligible for detail enrichment even when the
  // current rotating discovery window did not return them. Otherwise a pool
  // found once through DexPaprika can stay unnamed forever simply because it
  // is outside GeckoTerminal pages fetched in later runs.
  const persistedIncomplete = getDb()
    .prepare(
      `SELECT p.pool_key AS poolKey, p.chain_id AS chainId, p.dex_id AS dexId,
              p.dex_name AS dexName, p.dex_version AS dexVersion,
              p.pool_identifier AS poolIdentifier, p.identifier_kind AS identifierKind,
              p.base_symbol AS baseSymbol, p.base_token_address AS baseTokenAddress,
              p.quote_symbol AS quoteSymbol, p.quote_token_address AS quoteTokenAddress,
              p.fee_tier_label AS feeTierLabel, p.pool_created_at AS poolCreatedAt,
              m.liquidity_usd AS liquidityUsd, m.volume_24h_usd AS volume24hUsd,
              m.volume_7d_usd AS volume7dUsd, m.price_usd AS priceUsd,
              m.price_change_24h AS priceChange24h, m.fee_rate AS feeRate,
              m.fee_source AS feeSource, m.source, m.updated_at AS updatedAt,
              t.market_cap_usd AS marketCapUsd, t.fdv_usd AS fdvUsd
       FROM pools p
       JOIN pool_metrics m ON m.pool_key = p.pool_key
       LEFT JOIN tokens t ON t.chain_id = p.chain_id AND t.address = p.base_token_address
       WHERE p.base_symbol IS NULL OR p.quote_symbol IS NULL OR m.fee_rate IS NULL`,
    )
    .all() as (DiscoveredPool & { poolKey: string })[];
  for (const stored of persistedIncomplete) {
    if (merged.has(stored.poolKey)) continue;
    merged.set(stored.poolKey, stored);
  }

  // DexPaprika's search rows often omit symbols even when a previous sync has
  // already resolved them. Hydrate those known values before ranking detail
  // calls, otherwise the small GeckoTerminal budget is wasted re-fetching
  // complete pools while genuinely unnamed pools remain unresolved.
  const storedIdentities = getDb()
    .prepare(
      `SELECT pool_key AS poolKey, base_symbol AS baseSymbol,
              base_token_address AS baseTokenAddress,
              quote_symbol AS quoteSymbol,
              quote_token_address AS quoteTokenAddress
       FROM pools`,
    )
    .all() as {
    poolKey: string;
    baseSymbol: string | null;
    baseTokenAddress: string | null;
    quoteSymbol: string | null;
    quoteTokenAddress: string | null;
  }[];
  for (const stored of storedIdentities) {
    const pool = merged.get(stored.poolKey);
    if (!pool) continue;
    pool.baseSymbol ??= stored.baseSymbol;
    pool.baseTokenAddress ??= stored.baseTokenAddress;
    pool.quoteSymbol ??= stored.quoteSymbol;
    pool.quoteTokenAddress ??= stored.quoteTokenAddress;
  }

  // ---- Enrich: pool detail (identity + exact fee) ----
  /*
   * A single GeckoTerminal pool-detail response contains both token metadata
   * and the exact fee. Resolve it before spending separate token calls: pools
   * discovered through DexPaprika can otherwise remain address-only while the
   * token stage consumes the shared GeckoTerminal quota first.
   */
  const feeStaleBefore = new Date(now.getTime() - FEE_RECHECK_MS).toISOString();
  const knownFeeKeys = new Set(
    (
      getDb()
        .prepare(
          `SELECT pool_key AS poolKey FROM pool_metrics
           WHERE fee_rate IS NOT NULL OR fee_checked_at >= ?`,
        )
        .all(feeStaleBefore) as { poolKey: string }[]
    ).map((row) => row.poolKey),
  );
  const feeCheckedKeys = new Set<string>();
  const ranked = [...merged.values()].sort((a, b) => {
    const aMissingSymbol = !a.baseSymbol || !a.quoteSymbol;
    const bMissingSymbol = !b.baseSymbol || !b.quoteSymbol;
    const missingSymbolPriority = Number(bMissingSymbol) - Number(aMissingSymbol);
    if (missingSymbolPriority) return missingSymbolPriority;
    if (aMissingSymbol && bMissingSymbol) {
      return (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1);
    }
    const missingVolumePriority = Number(b.volume24hUsd === null) - Number(a.volume24hUsd === null);
    const aNeedsFee = a.feeRate === null && !knownFeeKeys.has(poolKeyOf(a));
    const bNeedsFee = b.feeRate === null && !knownFeeKeys.has(poolKeyOf(b));
    const missingFeePriority = Number(bNeedsFee) - Number(aNeedsFee);
    return (
      missingVolumePriority ||
      missingFeePriority ||
      (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1)
    );
  });
  let detailCalls = 0;
  for (const pool of ranked) {
    if (detailCalls >= detailBudget) break;
    if (pool.identifierKind !== "address" && pool.identifierKind !== "bytes32") continue;
    const key = poolKeyOf(pool);
    const needsIdentity = !pool.baseSymbol || !pool.quoteSymbol;
    const needsFee = pool.feeRate === null && !knownFeeKeys.has(key);
    const needsVolume = pool.volume24hUsd === null;
    if (!needsIdentity && !needsFee && !needsVolume) continue;
    try {
      const detail = await fetchPoolDetail(pool.poolIdentifier);
      detailCalls++;
      if (!detail) continue;
      feeCheckedKeys.add(key);
      // Pool detail is authoritative for token ordering. DexPaprika sometimes
      // reports Arc's native zero-address USDC on the opposite side.
      pool.baseSymbol = detail.baseSymbol ?? pool.baseSymbol;
      pool.baseTokenAddress = detail.baseTokenAddress ?? pool.baseTokenAddress;
      pool.quoteSymbol = detail.quoteSymbol ?? pool.quoteSymbol;
      pool.quoteTokenAddress = detail.quoteTokenAddress ?? pool.quoteTokenAddress;
      pool.feeTierLabel = detail.feeTierLabel ?? pool.feeTierLabel;
      if (detail.feeRate) {
        pool.feeRate = detail.feeRate;
        pool.feeSource = "detail_api";
      }
      if (pool.liquidityUsd === null && detail.liquidityUsd !== null) {
        pool.liquidityUsd = detail.liquidityUsd;
      }
      if (pool.volume24hUsd === null && detail.volume24hUsd !== null) {
        pool.volume24hUsd = detail.volume24hUsd;
      }
      if (pool.marketCapUsd === null && detail.marketCapUsd !== null) {
        pool.marketCapUsd = detail.marketCapUsd;
      }
      if (pool.fdvUsd === null && detail.fdvUsd !== null) {
        pool.fdvUsd = detail.fdvUsd;
      }
      pool.poolCreatedAt = detail.poolCreatedAt ?? pool.poolCreatedAt;
    } catch (err) {
      warnings.push(
        `Pool detail lookup paused for ${pool.poolIdentifier.slice(0, 10)}…: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      break;
    }
  }

  // ---- Enrich: token metadata for pools discovered without symbols ----
  /*
   * DexPaprika's search payload carries token addresses only, so any pool it
   * discovered alone renders as a blank pair until the token is named. Two
   * upstreams are tried, GeckoTerminal first and DexPaprika second, because
   * their quotas are separate: when GeckoTerminal is exhausted (measured: a
   * hard 429 mid-sync) the DexPaprika pass still makes progress instead of the
   * whole enrichment stage aborting on the first failure.
   */
  const unknownTokens = new Map<string, Set<"base" | "quote">>();
  const addUnknown = (address: string | null, role: "base" | "quote") => {
    if (!address) return;
    const roles = unknownTokens.get(address) ?? new Set<"base" | "quote">();
    roles.add(role);
    unknownTokens.set(address, roles);
  };
  for (const pool of merged.values()) {
    if (!pool.baseSymbol) addUnknown(pool.baseTokenAddress, "base");
    if (!pool.quoteSymbol) addUnknown(pool.quoteTokenAddress, "quote");
  }

  /*
   * Valuation enrichment. The GeckoTerminal LIST endpoint returns market cap for
   * the pool's base token, but it is null for most Arc tokens, whereas the
   * per-token endpoint returns it for some of them (measured: cirbtc resolves
   * to $510.3M while the list endpoint reports null). So a pool that already has
   * a symbol can still be missing its valuation and must also be queued —
   * previously only symbol-less pools were looked up, which left market-cap
   * coverage at ~5% of pools even though the data was reachable.
   *
   * FDV is queued for the same reason and is never used to stand in for MCAP.
   */
  const valuationTokens = new Set<string>();
  for (const pool of merged.values()) {
    const address = pool.baseTokenAddress;
    if (!address || address.startsWith("0x0000")) continue;
    if (pool.marketCapUsd === null || pool.fdvUsd === null) valuationTokens.add(address);
  }

  const pending = new Set(unknownTokens.keys());
  // Valuation-only lookups are appended after symbol resolution so naming a
  // pool always wins priority over enriching an already-named one.
  for (const address of valuationTokens) pending.add(address);
  const resolved = new Map<string, { symbol: string | null; fdvUsd: number | null }>();

  const applyToken = (
    address: string,
    symbol: string | null,
    fdvUsd: number | null,
  ) => {
    resolved.set(address, { symbol, fdvUsd });
    for (const pool of merged.values()) {
      if (!pool.baseSymbol && pool.baseTokenAddress === address && symbol) {
        pool.baseSymbol = symbol;
      }
      if (!pool.quoteSymbol && pool.quoteTokenAddress === address && symbol) {
        pool.quoteSymbol = symbol;
      }
      /*
       * FDV is filled regardless of whether the symbol was resolved above: a
       * token that already had a symbol can still be missing its valuation.
       * FDV is stored only in its own field and is never used as a market-cap
       * substitute.
       */
      if (pool.baseTokenAddress === address && pool.fdvUsd === null && fdvUsd) {
        pool.fdvUsd = fdvUsd;
      }
    }
  };

  // Pass 1 — GeckoTerminal (also the only source of market cap here).
  let gtTokenCalls = 0;
  for (const address of pending) {
    if (gtTokenCalls >= tokenBudget) break;
    try {
      const meta = await fetchTokenMetadata(address);
      gtTokenCalls++;
      if (!meta) continue;
      applyToken(address, meta.symbol, meta.fdvUsd);
      for (const pool of merged.values()) {
        if (
          pool.baseTokenAddress === address &&
          pool.marketCapUsd === null &&
          meta.marketCapUsd !== null
        ) {
          pool.marketCapUsd = meta.marketCapUsd;
        }
      }
      pending.delete(address);
    } catch (err) {
      warnings.push(
        `GeckoTerminal token lookup paused (${address.slice(0, 10)}…): ${
          err instanceof Error ? err.message : String(err)
        }. Falling back to DexPaprika for the remaining symbols.`,
      );
      break; // quota exhausted — hand the rest to the second upstream
    }
  }

  // Pass 2 — DexPaprika, on a separate quota.
  let dpTokenCalls = 0;
  for (const address of pending) {
    if (dpTokenCalls >= (options.tokenBudget ?? DEFAULTS.tokenBudget)) break;
    try {
      const meta = await fetchToken(address);
      dpTokenCalls++;
      if (!meta) continue;
      applyToken(address, meta.symbol, meta.fdvUsd);
    } catch (err) {
      warnings.push(
        `DexPaprika token lookup paused: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  }

  // Pass 3 — direct Arc RPC. ERC-20 symbol() is deterministic on-chain and
  // avoids leaving address-only rows when both third-party indexers miss a
  // newly deployed token. This pass is for names only, never valuation.
  let rpcTokenCalls = 0;
  for (const address of unknownTokens.keys()) {
    if (!pending.has(address) || rpcTokenCalls >= rpcTokenBudget) continue;
    if (/^0x0{40}$/i.test(address)) {
      applyToken(address, "USDC", null);
      pending.delete(address);
      continue;
    }
    try {
      rpcTokenCalls++;
      const symbol = await fetchTokenSymbol(address);
      if (!symbol) continue;
      applyToken(address, symbol, null);
      pending.delete(address);
    } catch (err) {
      warnings.push(
        `Arc RPC token lookup paused: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  }

  // ---- Calculate / Validate / Upsert ----
  const db = getDb();
  const seenKeys: string[] = [];
  let flagged = 0;

  const upsertPool = db.prepare(`
    INSERT INTO pools (pool_key, chain_id, dex_id, dex_name, dex_version, pool_identifier,
      identifier_kind, base_symbol, base_token_address, quote_symbol, quote_token_address,
      fee_tier_label, pool_created_at, first_seen_at, source)
    VALUES (@poolKey, @chainId, @dexId, @dexName, @dexVersion, @poolIdentifier,
      @identifierKind, @baseSymbol, @baseTokenAddress, @quoteSymbol, @quoteTokenAddress,
      @feeTierLabel, @poolCreatedAt, @firstSeenAt, @source)
    ON CONFLICT(pool_key) DO UPDATE SET
      dex_name = excluded.dex_name,
      dex_version = excluded.dex_version,
      base_symbol = COALESCE(excluded.base_symbol, pools.base_symbol),
      base_token_address = COALESCE(excluded.base_token_address, pools.base_token_address),
      quote_symbol = COALESCE(excluded.quote_symbol, pools.quote_symbol),
      quote_token_address = COALESCE(excluded.quote_token_address, pools.quote_token_address),
      fee_tier_label = COALESCE(excluded.fee_tier_label, pools.fee_tier_label),
      pool_created_at = COALESCE(excluded.pool_created_at, pools.pool_created_at)
  `);
  /* Each valuation field is updated only when that field was actually reported.
   * This preserves a CMC fallback market cap when GeckoTerminal reports only FDV,
   * while still allowing an invalid non-null market cap to be cleared after the
   * consistency check rejects it. */
  const upsertToken = db.prepare(`
    INSERT INTO tokens (chain_id, address, name, symbol, decimals, market_cap_usd, fdv_usd)
    VALUES (@chainId, @address, @name, @symbol, @decimals, @marketCapUsd, @fdvUsd)
    ON CONFLICT(chain_id, address) DO UPDATE SET
      name = COALESCE(excluded.name, tokens.name),
      symbol = COALESCE(excluded.symbol, tokens.symbol),
      market_cap_usd = CASE WHEN @marketCapProvided = 1 THEN excluded.market_cap_usd ELSE tokens.market_cap_usd END,
      fdv_usd = CASE WHEN @fdvProvided = 1 THEN excluded.fdv_usd ELSE tokens.fdv_usd END
  `);
  const upsertMetrics = db.prepare(`
    INSERT INTO pool_metrics (pool_key, liquidity_usd, volume_24h_usd, volume_7d_usd, price_usd,
      price_change_24h, fee_rate, fee_source, fee_checked_at, apr_24h, apr_7d, apr_method, apr_confidence,
      apr_reason, source, updated_at, stale)
    VALUES (@poolKey, @liquidityUsd, @volume24hUsd, @volume7dUsd, @priceUsd, @priceChange24h,
      @feeRate, @feeSource, @feeCheckedAt, @apr24h, @apr7d, @aprMethod, @aprConfidence, @aprReason,
      @source, @updatedAt, 0)
    ON CONFLICT(pool_key) DO UPDATE SET
      liquidity_usd = excluded.liquidity_usd,
      volume_24h_usd = excluded.volume_24h_usd,
      volume_7d_usd = excluded.volume_7d_usd,
      price_usd = excluded.price_usd,
      price_change_24h = excluded.price_change_24h,
      fee_rate = excluded.fee_rate,
      fee_source = excluded.fee_source,
      fee_checked_at = COALESCE(excluded.fee_checked_at, pool_metrics.fee_checked_at),
      apr_24h = excluded.apr_24h,
      apr_7d = excluded.apr_7d,
      apr_method = excluded.apr_method,
      apr_confidence = excluded.apr_confidence,
      apr_reason = excluded.apr_reason,
      source = excluded.source,
      updated_at = excluded.updated_at,
      stale = 0
  `);
  const insertSnapshot = db.prepare(`
    INSERT OR REPLACE INTO pool_snapshots (pool_key, captured_at, liquidity_usd, volume_24h_usd, est_apr_24h)
    VALUES (?, ?, ?, ?, ?)
  `);
  const clearFlags = db.prepare(
    `DELETE FROM pool_flags
     WHERE pool_key = ?
       AND flag NOT IN ('mcap_estimated_cmc', 'mcap_estimated_dexscreener', 'holders_cmc')`,
  );
  const insertFlag = db.prepare(
    `INSERT OR REPLACE INTO pool_flags (pool_key, flag, detail) VALUES (?, ?, ?)`,
  );
  const clearEstimatedMcapFlags = db.prepare(
    `DELETE FROM pool_flags WHERE pool_key = ? AND flag LIKE 'mcap_estimated_%'`,
  );

  const run = db.transaction(() => {
    for (const pool of merged.values()) {
      const key = poolKeyOf(pool);
      seenKeys.push(key);

      // A fee we verified on an earlier sync must not be erased because this run
      // was rate-limited before it could re-check the pool. Fees change slowly;
      // the row is re-verified whenever the quota allows.
      if (pool.feeRate === null) {
        const previous = db
          .prepare(`SELECT fee_rate AS feeRate, fee_source AS feeSource FROM pool_metrics WHERE pool_key = ?`)
          .get(key) as { feeRate: number | null; feeSource: string | null } | undefined;
        if (previous?.feeRate) {
          pool.feeRate = previous.feeRate;
          pool.feeSource = (previous.feeSource as DiscoveredPool["feeSource"]) ?? "detail_api";
          retainedFeeKeys.add(key);
        }
      }

      // Same principle for market data: an upstream response that omits a metric
      // this cycle should not silently delete a value we already verified.
      const previousMetrics = db
        .prepare(`SELECT liquidity_usd AS liquidityUsd, volume_24h_usd AS volume24hUsd
                  FROM pool_metrics WHERE pool_key = ?`)
        .get(key) as { liquidityUsd: number | null; volume24hUsd: number | null } | undefined;
      if (previousMetrics) {
        if (pool.liquidityUsd === null && previousMetrics.liquidityUsd !== null) {
          pool.liquidityUsd = previousMetrics.liquidityUsd;
          carriedKeys.add(key);
        }
        if (pool.volume24hUsd === null && previousMetrics.volume24hUsd !== null) {
          pool.volume24hUsd = previousMetrics.volume24hUsd;
          carriedKeys.add(key);
        }
      }

      const apr24 = computeApr24h({
        volume24hUsd: pool.volume24hUsd,
        liquidityUsd: pool.liquidityUsd,
        feeRate: pool.feeRate,
        feeSource: pool.feeSource,
        poolCreatedAt: pool.poolCreatedAt,
        now,
      });
      const { avg, samples } = averageLiquidityOver7d(key, now);
      const apr7 = computeApr7d({
        volume7dUsd: pool.volume7dUsd,
        feeRate: pool.feeRate,
        feeSource: pool.feeSource,
        poolCreatedAt: pool.poolCreatedAt,
        averageLiquidity7dUsd: avg,
        sampleCount: samples,
        now,
      });

      // Market cap is only trusted when it is internally consistent with FDV.
      const marketCapProvided = pool.marketCapUsd !== null;
      const fdvProvided = pool.fdvUsd !== null;
      const valuation = sanitizeValuation(pool.marketCapUsd, pool.fdvUsd);
      pool.marketCapUsd = valuation.marketCapUsd;
      pool.fdvUsd = valuation.fdvUsd;

      const flags = detectFlags(pool);
      if (valuation.grade === "discarded") {
        flags.push({ flag: "mcap_discarded", detail: valuation.reason });
      } else if (valuation.grade === "above_fdv") {
        // A distinct, milder label: the figure is kept, so calling it
        // "inconsistent" would overstate what we actually know.
        flags.push({ flag: "mcap_above_fdv", detail: valuation.reason });
      }
      if (conflictedKeys.has(key)) {
        flags.push({
          flag: "source_conflict",
          detail: "Liquidity from GeckoTerminal and DexPaprika differ by more than 25%; the primary source value is shown and both are kept.",
        });
      }
      if (retainedFeeKeys.has(key)) {
        flags.push({
          flag: "fee_retained",
          detail: "Upstream quota was exhausted this cycle, so the fee rate from an earlier verified sync is reused. Treat APR as slightly stale.",
        });
      }
      if (carriedKeys.has(key)) {
        flags.push({
          flag: "metric_carried",
          detail: "This pool's liquidity or volume was missing in the latest upstream response; the last successful value is shown.",
        });
      }
      const wrappers = wrappedKeys.get(key);
      if (wrappers?.length) {
        flags.push({
          flag: "v4_wrapper",
          detail: `Same Uniswap v4 Pool ID also indexed as: ${[...new Set(wrappers)].join(", ")}. Counted once.`,
        });
      }
      if (flags.length) flagged++;

      upsertPool.run({
        poolKey: key,
        chainId: pool.chainId,
        dexId: pool.dexId,
        dexName: pool.dexName,
        dexVersion: pool.dexVersion,
        poolIdentifier: pool.poolIdentifier,
        identifierKind: pool.identifierKind,
        baseSymbol: pool.baseSymbol,
        baseTokenAddress: pool.baseTokenAddress,
        quoteSymbol: pool.quoteSymbol,
        quoteTokenAddress: pool.quoteTokenAddress,
        feeTierLabel: pool.feeTierLabel ?? (pool.feeRate ? `${pool.feeRate * 100}%` : null),
        // On-chain creation time only; never first_seen_at.
        poolCreatedAt: pool.poolCreatedAt,
        firstSeenAt: now.toISOString(),
        source: pool.source,
      });

      if (pool.baseTokenAddress) {
        upsertToken.run({
          chainId: pool.chainId,
          address: pool.baseTokenAddress,
          name: pool.baseSymbol,
          symbol: pool.baseSymbol,
          decimals: null,
          // MCAP is only stored when the source actually reported one; FDV never
          // silently becomes MCAP.
          marketCapUsd: pool.marketCapUsd,
          fdvUsd: pool.fdvUsd,
          marketCapProvided: marketCapProvided ? 1 : 0,
          fdvProvided: fdvProvided ? 1 : 0,
        });
      }

      upsertMetrics.run({
        poolKey: key,
        liquidityUsd: pool.liquidityUsd,
        volume24hUsd: pool.volume24hUsd,
        volume7dUsd: pool.volume7dUsd,
        priceUsd: pool.priceUsd,
        priceChange24h: pool.priceChange24h,
        feeRate: pool.feeRate,
        feeSource: pool.feeSource,
        feeCheckedAt: feeCheckedKeys.has(key) ? now.toISOString() : null,
        apr24h: apr24.apr24h,
        apr7d: apr7.apr7d,
        aprMethod: apr24.method,
        aprConfidence: apr24.confidence === "na" ? apr24.confidence : apr7.apr7d !== null ? apr7.confidence : apr24.confidence,
        aprReason: apr24.reason ?? apr7.reason,
        source: pool.source,
        updatedAt: pool.updatedAt,
      });

      insertSnapshot.run(
        key,
        now.toISOString(),
        pool.liquidityUsd,
        pool.volume24hUsd,
        apr24.apr24h,
      );

      clearFlags.run(key);
      if (marketCapProvided) clearEstimatedMcapFlags.run(key);
      for (const flag of flags) insertFlag.run(key, flag.flag, flag.detail);
    }

    /*
     * Pools absent from this run keep their last known values. "Stale" must mean
     * "this data may be out of date", NOT "this run did not happen to cover the
     * page the pool lives on" — with page rotation every run sees only a slice,
     * and marking the untouched slice stale would flag the entire database.
     * A pool is therefore stale only once its own data has aged past the window.
     */
    const staleCutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
    db.prepare(
      `UPDATE pool_metrics SET stale = 1 WHERE updated_at < ?`,
    ).run(staleCutoff);
    db.prepare(
      `UPDATE pool_metrics SET stale = 0 WHERE updated_at >= ?`,
    ).run(staleCutoff);
  });

  run();

  const dexScreener = await refreshKnownPoolsFromDexScreener(now);
  if (dexScreener.errors.length) {
    warnings.push(
      `DexScreener refresh completed with ${dexScreener.errors.length} failed batch(es).`,
    );
  }
  const missingVolume = await refreshMissingVolumesFromGeckoTerminal(now);
  if (missingVolume.errors.length) {
    warnings.push("GeckoTerminal missing-volume fallback stopped after an upstream error.");
  }
  const coinMarketCap = await refreshKnownTokensFromCoinMarketCap(
    now,
    options.cmcTokenBudget ?? DEFAULTS.cmcTokenBudget,
  );
  if (coinMarketCap.errors.length) {
    warnings.push(
      `CoinMarketCap token enrichment completed with ${coinMarketCap.errors.length} error(s).`,
    );
  }

  const result: SyncResult = {
    discovered: merged.size,
    upserted: seenKeys.length,
    flagged,
    pagesFetched,
    startPage,
    detailCalls,
    gtTokenCalls,
    dpTokenCalls,
    rpcTokenCalls,
    tokensUnresolved: pending.size,
    crossCheck,
    dexScreener,
    missingVolume,
    coinMarketCap,
    warnings,
    startedAt,
    finishedAt: new Date().toISOString(),
  };

  recordJob("pools_sync", warnings.length && merged.size === 0 ? "failed" : "success", {
    lastError: merged.size === 0 ? (warnings[0] ?? "no pools discovered") : null,
    stats: result,
    nextRunAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  return result;
}

/**
 * Cross-source merge. GeckoTerminal wins on liquidity/volume; DexPaprika fills
 * only the fields GT cannot provide (7d volume, creation time). Disagreement is
 * flagged instead of overwriting the primary value.
 */
function mergePool(primary: DiscoveredPool | undefined, incoming: DiscoveredPool): DiscoveredPool {
  if (!primary) return incoming;
  if (incoming.source === primary.source) {
    return { ...primary, ...stripNulls(incoming) };
  }

  const liqPrimary = primary.liquidityUsd;
  const liqIncoming = incoming.liquidityUsd;
  if (liqPrimary && liqIncoming) {
    const drift = Math.abs(liqPrimary - liqIncoming) / Math.max(liqPrimary, liqIncoming);
    if (drift > LIQ_CONFLICT_THRESHOLD) {
      incoming = {
        ...incoming,
        liquidityUsd: liqPrimary,
        source: `${primary.source}+${incoming.source}`,
      };
    }
  }

  return {
    ...primary,
    volume7dUsd: primary.volume7dUsd ?? incoming.volume7dUsd,
    poolCreatedAt: primary.poolCreatedAt ?? incoming.poolCreatedAt,
    baseTokenAddress: primary.baseTokenAddress ?? incoming.baseTokenAddress,
    quoteTokenAddress: primary.quoteTokenAddress ?? incoming.quoteTokenAddress,
    baseSymbol: primary.baseSymbol ?? incoming.baseSymbol,
    quoteSymbol: primary.quoteSymbol ?? incoming.quoteSymbol,
    dexName: primary.dexName ?? incoming.dexName,
  };
}

function stripNulls(pool: DiscoveredPool): Partial<DiscoveredPool> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pool)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out as Partial<DiscoveredPool>;
}
