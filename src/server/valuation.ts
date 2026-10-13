/**
 * Value sanity checks applied before anything reaches the database.
 *
 * The leaderboard's credibility depends on refusing to print a number we can
 * show is wrong. Live Arc data provided the example: GeckoTerminal reported a
 * $72.68B market cap against a $0.51B FDV for the same token — market cap
 * cannot exceed fully diluted valuation. Both values were internally
 * inconsistent, so neither is shown; the pair becomes N/A with a flag.
 */

/*
 * Two tiers, because the two real cases seen on Arc are not equivalent:
 *   - USDC: market cap $72.68B vs FDV $0.51B — a 140x gap, unambiguously
 *     wrong, so both figures are discarded;
 *   - cirbtc: market cap $517M vs FDV $444M — a 16% gap, most likely an
 *     upstream FDV computed on a different supply, and the market cap is
 *     believable, so it is kept and only flagged.
 * Discarding the second kind would throw away a correct headline number;
 * keeping the first would print nonsense.
 */
const FDV_TOLERANCE = 1.05;
const FDV_DISCARD_RATIO = 2;

export type SanitizedValues = {
  marketCapUsd: number | null;
  fdvUsd: number | null;
  reason: string | null;
};

export function sanitizeValuation(
  marketCapUsd: number | null,
  fdvUsd: number | null,
): SanitizedValues {
  const mcap = marketCapUsd !== null && marketCapUsd > 0 ? marketCapUsd : null;
  const fdv = fdvUsd !== null && fdvUsd > 0 ? fdvUsd : null;

  if (mcap === null) {
    return { marketCapUsd: null, fdvUsd: fdv, reason: null };
  }

  if (fdv === null) {
    // No FDV to contradict it; the figure stands on its own.
    return { marketCapUsd: mcap, fdvUsd: null, reason: null };
  }

  if (mcap > fdv * FDV_DISCARD_RATIO) {
    return {
      marketCapUsd: null,
      fdvUsd: null,
      reason: `Upstream market cap ($${Math.round(mcap).toLocaleString("en-US")}) exceeds its own FDV ($${Math.round(fdv).toLocaleString("en-US")}) by more than 2x, which is impossible; both figures were discarded rather than shown.`,
    };
  }

  if (mcap > fdv * FDV_TOLERANCE) {
    return {
      marketCapUsd: mcap,
      fdvUsd: fdv,
      reason: `Market cap ($${Math.round(mcap).toLocaleString("en-US")}) sits above the reported FDV ($${Math.round(fdv).toLocaleString("en-US")}); likely an upstream supply mismatch — treat the cap with care.`,
    };
  }

  return { marketCapUsd: mcap, fdvUsd: fdv, reason: null };
}