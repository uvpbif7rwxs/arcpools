/**
 * Estimated Fee APR engine.
 *
 * Only two things are computed here, both pool-level and fee-only:
 *   APR_24h = volume_24h_usd × effective_lp_fee_rate × 365 ÷ liquidity_usd × 100
 *   APR_7d  = lp_fees_7d_usd ÷ average_liquidity_7d_usd × (365 ÷ 7) × 100
 *
 * Explicitly excluded (per PRD §4.1): incentive tokens, price change,
 * impermanent loss, gas and rebalancing cost. Nothing here is a position-level
 * or wallet-level return.
 *
 * Every non-computable combination returns `confidence: "na"` with a reason
 * string that the UI renders next to the N/A. A missing input never becomes 0.
 */
import type { AprResult } from "./types";

const DAYS_PER_YEAR = 365;

export type Apr24hInput = {
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  /** Effective LP fee fraction (0.003 = 0.3%). Null when unknown. */
  feeRate: number | null;
  feeSource: "detail_api" | "pool_name" | "unknown";
  poolCreatedAt: string | null;
  now?: Date;
};

/** Pools younger than this are flagged so a single-day spike is not sold as stability. */
const LOW_HISTORY_MS = 24 * 60 * 60 * 1000;

export function computeApr24h(input: Apr24hInput): AprResult {
  const { volume24hUsd, liquidityUsd, feeRate, feeSource, poolCreatedAt } = input;
  const na = (reason: string, method: string): AprResult => ({
    apr24h: null,
    apr7d: null,
    method,
    confidence: "na",
    reason,
  });

  if (feeRate === null || feeSource === "unknown") {
    return na(
      "Effective LP fee rate is unknown for this pool, so fee APR cannot be computed without inventing a rate.",
      "unavailable",
    );
  }
  if (!(feeRate > 0) || feeRate >= 1) {
    return na(`Reported fee rate ${feeRate} is outside a plausible range.`, "unavailable");
  }
  if (liquidityUsd === null || liquidityUsd <= 0) {
    return na("Liquidity is zero or unreported upstream, so there is no denominator for the annualization.", "unavailable");
  }
  if (volume24hUsd === null) {
    return na("24h pool volume is unavailable upstream.", "unavailable");
  }

  const apr24h = (volume24hUsd * feeRate * DAYS_PER_YEAR * 100) / liquidityUsd;
  if (!Number.isFinite(apr24h)) {
    return na("APR calculation produced a non-finite result.", "unavailable");
  }

  const created = poolCreatedAt ? Date.parse(poolCreatedAt) : NaN;
  const ageMs = (input.now ?? new Date()).getTime() - created;
  const tooYoung = Number.isFinite(ageMs) && ageMs < LOW_HISTORY_MS;

  if (tooYoung) {
    return {
      apr24h,
      apr7d: null,
      method:
        feeSource === "detail_api"
          ? "24h volume × pool fee × 365 ÷ liquidity (fee from pool detail endpoint)"
          : "24h volume × fee parsed from pool name × 365 ÷ liquidity (assumed fee)",
      confidence: "low_history",
      reason: `Pool is younger than 24h (created ${poolCreatedAt}). One day of volume is not a stable yield signal.`,
    };
  }

  return {
    apr24h,
    apr7d: null,
    method:
      feeSource === "detail_api"
        ? "24h volume × pool fee × 365 ÷ liquidity (fee from pool detail endpoint)"
        : "24h volume × fee parsed from pool name × 365 ÷ liquidity (assumed fee)",
    confidence: feeSource === "detail_api" ? "verified" : "estimated",
    reason:
      feeSource === "detail_api"
        ? null
        : "Fee was parsed from the pool name rather than a fee-bearing endpoint; treat as approximate.",
  };
}

export type Apr7dInput = {
  volume7dUsd: number | null;
  feeRate: number | null;
  feeSource: "detail_api" | "pool_name" | "unknown";
  poolCreatedAt: string | null;
  /** Arithmetic mean of liquidity samples over the window, from our snapshots. */
  averageLiquidity7dUsd: number | null;
  /** How many snapshot samples back the average; needs >= 12 for an hourly week. */
  sampleCount: number;
  now?: Date;
};

const MIN_SAMPLES_7D = 12;

export function computeApr7d(input: Apr7dInput): AprResult {
  const { volume7dUsd, feeRate, feeSource, averageLiquidity7dUsd, sampleCount, poolCreatedAt } = input;
  const na = (reason: string, method: string): AprResult => ({
    apr24h: null,
    apr7d: null,
    method,
    confidence: "na",
    reason,
  });

  if (feeRate === null || feeSource === "unknown") {
    return na("Effective LP fee rate is unknown, so 7D fee APR cannot be estimated.", "unavailable");
  }
  if (!volume7dUsd) {
    return na("7D volume is not reported by any connected source for this pool.", "unavailable");
  }
  if (poolCreatedAt) {
    const ageMs = (input.now ?? new Date()).getTime() - Date.parse(poolCreatedAt);
    if (Number.isFinite(ageMs) && ageMs < 7 * 24 * 60 * 60 * 1000) {
      return na("Pool is younger than 7 days, so a 7-day annualization has no full window behind it.", "insufficient_history");
    }
  }
  if (!averageLiquidity7dUsd || averageLiquidity7dUsd <= 0 || sampleCount < MIN_SAMPLES_7D) {
    return na(
      `Needs at least ${MIN_SAMPLES_7D} historical liquidity snapshots to average 7D liquidity (have ${sampleCount}).`,
      "insufficient_history",
    );
  }

  const lpFees7d = volume7dUsd * feeRate;
  const apr7d = (lpFees7d / averageLiquidity7dUsd) * (DAYS_PER_YEAR / 7) * 100;

  return {
    apr24h: null,
    apr7d: Number.isFinite(apr7d) ? apr7d : null,
    method: "7D volume × fee ÷ 7D average liquidity × (365 ÷ 7); average liquidity from our own snapshots",
    confidence: feeSource === "detail_api" ? "verified" : "estimated",
    reason:
      feeSource === "detail_api"
        ? null
        : "Fee was parsed from the pool name; the 7D figure inherits that approximation.",
  };
}

/**
 * Turn APR + market context into the "Highest Est. Fee APR" stat card.
 * A 900% APR on a $4k pool is not a headline — minimum liquidity is part of the filter.
 */
export function summarizeHighestApr(
  rows: { apr24h: number | null; liquidityUsd: number | null; confidence: string | null }[],
  minLiquidityUsd = 10_000,
): { apr24h: number | null; poolLabel: string | null } {
  const eligible = rows.filter(
    (row) =>
      row.apr24h !== null &&
      row.apr24h > 0 &&
      row.confidence !== "na" &&
      (row.liquidityUsd ?? 0) >= minLiquidityUsd,
  );
  if (eligible.length === 0) return { apr24h: null, poolLabel: null };
  const best = eligible.reduce((a, b) => ((a.apr24h ?? 0) >= (b.apr24h ?? 0) ? a : b));
  return { apr24h: best.apr24h ?? null, poolLabel: null };
}