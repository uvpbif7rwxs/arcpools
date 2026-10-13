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
import { discoverPools } from "./sources/dexpaprika";
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
  now?: Date;
};

export type SyncResult = {
  discovered: number;
  upserted: number;
  flagged: number;
  pagesFetched: number;
  startPage: number;
  detailCalls: number;
  tokenCalls: number;
  crossCheck: { pools: number; error: string | null; truncated: boolean };
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

/**
 * How old a pool's own data may get before the row is shown as stale. Comfortably
 * longer than the rotation cycle so a pool is not flagged between its own visits.
 */
const STALE_AFTER_MS = Number(process.env.SYNC_STALE_AFTER_MS ?? 60 * 60_000);

/** Relative disagreement above which two sources are considered to conflict. */
const LIQ_CONFLICT_THRESHOLD = 0.25;

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

export async function runSync(options: SyncOptions = {}): Promise<SyncResult> {
  const maxPages = Math.min(options.maxPages ?? DEFAULTS.maxPages, GT_MAX_PAGE);
  const detailBudget = options.detailBudget ?? DEFAULTS.detailBudget;
  const tokenBudget = options.tokenBudget ?? DEFAULTS.tokenBudget;
  const now = options.now ?? new Date();
  // Rotating start page keeps each run inside GeckoTerminal's keyless quota:
  // a full 10-page crawl on every tick exceeds it and ends in a hard 429.
  const startPage = options.startPage ?? rotatingStartPage(maxPages, now);
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
      cursor = cursor >= maxPages ? 1 : cursor + 1;
      // A short page is the real end of the list; nothing beyond it exists.
      if (!result.hasMore && cursor === 1) break;
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

  // ---- Enrich: token metadata for pools discovered without symbols ----
  // DexPaprika's search payload carries token addresses only, so any pool it
  // discovered alone would render as a blank pair. Each lookup is rate-limited.
  const unknownTokens = new Map<string, "base" | "quote">();
  for (const pool of merged.values()) {
    if (!pool.baseSymbol && pool.baseTokenAddress) unknownTokens.set(pool.baseTokenAddress, "base");
    if (!pool.quoteSymbol && pool.quoteTokenAddress) {
      if (!unknownTokens.has(pool.quoteTokenAddress)) unknownTokens.set(pool.quoteTokenAddress, "quote");
    }
  }
  let tokenCalls = 0;
  for (const [address, role] of unknownTokens) {
    if (tokenCalls >= tokenBudget) break;
    try {
      const meta = await fetchTokenMetadata(address);
      tokenCalls++;
      if (!meta) continue;
      for (const pool of merged.values()) {
        if (role === "base" && pool.baseTokenAddress === address && !pool.baseSymbol) {
          pool.baseSymbol = meta.symbol;
          if (pool.marketCapUsd === null) pool.marketCapUsd = meta.marketCapUsd;
          if (pool.fdvUsd === null) pool.fdvUsd = meta.fdvUsd;
        }
        if (role === "quote" && pool.quoteTokenAddress === address && !pool.quoteSymbol) {
          pool.quoteSymbol = meta.symbol;
        }
      }
    } catch (err) {
      warnings.push(`Token metadata lookup failed for ${address.slice(0, 10)}…: ${err instanceof Error ? err.message : String(err)}`);
      break; // upstream is throttling
    }
  }

  // ---- Enrich: exact fee for the most important pools only ----
  // The detail endpoint is one rate-limit slot per call, so it is budgeted to
  // the top of the leaderboard where the number actually gets read.
  const ranked = [...merged.values()].sort(
    (a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1),
  );
  let detailCalls = 0;
  for (const pool of ranked) {
    if (detailCalls >= detailBudget) break;
    if (pool.identifierKind !== "address" && pool.identifierKind !== "bytes32") continue;
    try {
      const detail = await fetchPoolDetail(pool.poolIdentifier);
      detailCalls++;
      if (!detail) continue;
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
    } catch (err) {
      warnings.push(
        `Fee lookup failed for ${pool.baseSymbol}/${pool.quoteSymbol} (${pool.poolIdentifier.slice(0, 10)}…): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      break; // upstream is throttling; stop spending quota
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
  /*
   * COALESCE would resurrect a market cap that the valuation check has just
   * rejected, because the incoming value is NULL. So once a pool reports a
   * valuation at all, the sanitized pair (including NULL) is written through;
   * COALESCE only applies when this source offered nothing this cycle.
   */
  const upsertToken = db.prepare(`
    INSERT INTO tokens (chain_id, address, name, symbol, decimals, market_cap_usd, fdv_usd)
    VALUES (@chainId, @address, @name, @symbol, @decimals, @marketCapUsd, @fdvUsd)
    ON CONFLICT(chain_id, address) DO UPDATE SET
      name = COALESCE(excluded.name, tokens.name),
      symbol = COALESCE(excluded.symbol, tokens.symbol),
      market_cap_usd = CASE WHEN @valuationProvided = 1 THEN excluded.market_cap_usd ELSE COALESCE(excluded.market_cap_usd, tokens.market_cap_usd) END,
      fdv_usd = CASE WHEN @valuationProvided = 1 THEN excluded.fdv_usd ELSE COALESCE(excluded.fdv_usd, tokens.fdv_usd) END
  `);
  const upsertMetrics = db.prepare(`
    INSERT INTO pool_metrics (pool_key, liquidity_usd, volume_24h_usd, volume_7d_usd, price_usd,
      price_change_24h, fee_rate, fee_source, apr_24h, apr_7d, apr_method, apr_confidence,
      apr_reason, source, updated_at, stale)
    VALUES (@poolKey, @liquidityUsd, @volume24hUsd, @volume7dUsd, @priceUsd, @priceChange24h,
      @feeRate, @feeSource, @apr24h, @apr7d, @aprMethod, @aprConfidence, @aprReason,
      @source, @updatedAt, 0)
    ON CONFLICT(pool_key) DO UPDATE SET
      liquidity_usd = excluded.liquidity_usd,
      volume_24h_usd = excluded.volume_24h_usd,
      volume_7d_usd = excluded.volume_7d_usd,
      price_usd = excluded.price_usd,
      price_change_24h = excluded.price_change_24h,
      fee_rate = excluded.fee_rate,
      fee_source = excluded.fee_source,
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
  const clearFlags = db.prepare(`DELETE FROM pool_flags WHERE pool_key = ?`);
  const insertFlag = db.prepare(
    `INSERT OR REPLACE INTO pool_flags (pool_key, flag, detail) VALUES (?, ?, ?)`,
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
      const rawValuationReported = pool.marketCapUsd !== null || pool.fdvUsd !== null;
      const valuation = sanitizeValuation(pool.marketCapUsd, pool.fdvUsd);
      pool.marketCapUsd = valuation.marketCapUsd;
      pool.fdvUsd = valuation.fdvUsd;

      const flags = detectFlags(pool);
      if (valuation.reason) {
        flags.push({ flag: "mcap_inconsistent", detail: valuation.reason });
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
          valuationProvided: rawValuationReported ? 1 : 0,
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

  const result: SyncResult = {
    discovered: merged.size,
    upserted: seenKeys.length,
    flagged,
    pagesFetched,
    startPage,
    detailCalls,
    tokenCalls,
    crossCheck,
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