/**
 * APR unit tests — run with `npm test` (node:test, no runner dependency).
 *
 * The 21.90% case is the PRD's own worked example and acts as the regression
 * guard for the whole fee pipeline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeApr24h, computeApr7d } from "../src/server/apr.ts";
import { rotatingStartPage } from "../src/server/sync.ts";
import { sanitizeValuation } from "../src/server/valuation.ts";
import { parseFeeFromName, percentToFraction } from "../src/server/sources/geckoterminal.ts";

const OLD_POOL = "2026-09-01T00:00:00Z";
const NOW = new Date("2026-10-13T00:00:00Z");

test("PRD worked example: $100k volume, $500k liquidity, 0.30% fee => 21.90%", () => {
  const result = computeApr24h({
    volume24hUsd: 100_000,
    liquidityUsd: 500_000,
    feeRate: 0.003,
    feeSource: "detail_api",
    poolCreatedAt: OLD_POOL,
    now: NOW,
  });
  assert.equal(result.apr24h, 21.9);
  assert.equal(result.confidence, "verified");
  assert.equal(result.apr7d, null);
});

test("GT returns fee as a percent: '0.3' => 0.003 fraction", () => {
  assert.equal(percentToFraction("0.3"), 0.003);
  assert.equal(percentToFraction(1), 0.01);
  assert.equal(percentToFraction(0), null);
  assert.equal(percentToFraction(150), null);
});

test("fee parsed from pool name matches the detail endpoint when both exist", () => {
  assert.equal(parseFeeFromName("cirbtc / USDC 0.01%"), 0.0001);
  assert.equal(parseFeeFromName("AF / USDC 1%"), 0.01);
  assert.equal(parseFeeFromName("VIRTUAL / USDC"), null);
});

test("name-parsed fee downgrades confidence to estimated", () => {
  const result = computeApr24h({
    volume24hUsd: 100_000,
    liquidityUsd: 500_000,
    feeRate: parseFeeFromName("AF / USDC 1%"),
    feeSource: "pool_name",
    poolCreatedAt: OLD_POOL,
    now: NOW,
  });
  assert.equal(result.confidence, "estimated");
  assert.equal(result.apr24h, 73); // 100k × 1% × 365 ÷ 500k × 100
  assert.match(result.reason ?? "", /parsed from the pool name/);
});

test("unknown fee yields N/A, never 0 and never a 0.30% assumption", () => {
  const result = computeApr24h({
    volume24hUsd: 100_000,
    liquidityUsd: 500_000,
    feeRate: null,
    feeSource: "unknown",
    poolCreatedAt: OLD_POOL,
    now: NOW,
  });
  assert.equal(result.apr24h, null);
  assert.equal(result.confidence, "na");
  assert.match(result.reason ?? "", /Effective LP fee rate is unknown/);
});

test("zero liquidity yields N/A instead of Infinity", () => {
  const result = computeApr24h({
    volume24hUsd: 23_704,
    liquidityUsd: 0,
    feeRate: 0.0025,
    feeSource: "detail_api",
    poolCreatedAt: OLD_POOL,
    now: NOW,
  });
  assert.equal(result.apr24h, null);
  assert.equal(result.confidence, "na");
  assert.match(result.reason ?? "", /Liquidity is zero/);
});

test("missing volume yields N/A", () => {
  const result = computeApr24h({
    volume24hUsd: null,
    liquidityUsd: 500_000,
    feeRate: 0.003,
    feeSource: "detail_api",
    poolCreatedAt: OLD_POOL,
    now: NOW,
  });
  assert.equal(result.apr24h, null);
  assert.match(result.reason ?? "", /24h pool volume is unavailable/);
});

test("pools younger than 24h are low_history even with a computable APR", () => {
  const result = computeApr24h({
    volume24hUsd: 84_262,
    liquidityUsd: 10_000,
    feeRate: 0.01,
    feeSource: "detail_api",
    poolCreatedAt: "2026-10-12T08:38:25Z",
    now: NOW,
  });
  assert.equal(result.confidence, "low_history");
  assert.ok((result.apr24h ?? 0) > 0);
  assert.match(result.reason ?? "", /younger than 24h/);
});

test("7D APR needs enough snapshot samples to average liquidity", () => {
  const base = {
    volume7dUsd: 700_000,
    feeRate: 0.003,
    feeSource: "detail_api",
    poolCreatedAt: OLD_POOL,
    now: NOW,
  } as const;
  const thin = computeApr7d({ ...base, averageLiquidity7dUsd: 500_000, sampleCount: 4 });
  assert.equal(thin.apr7d, null);
  assert.equal(thin.confidence, "na");
  assert.match(thin.reason ?? "", /at least 12 historical liquidity snapshots/);

  const full = computeApr7d({ ...base, averageLiquidity7dUsd: 500_000, sampleCount: 40 });
  assert.equal(full.apr7d, 21.9); // (700k×0.003 ÷ 500k) × (365/7) × 100 — same daily rate as the 24h case
  assert.equal(full.confidence, "verified");
});

test("7D APR is N/A for a pool younger than 7 days", () => {
  const result = computeApr7d({
    volume7dUsd: 700_000,
    feeRate: 0.003,
    feeSource: "detail_api",
    poolCreatedAt: "2026-10-10T00:00:00Z",
    averageLiquidity7dUsd: 500_000,
    sampleCount: 100,
    now: NOW,
  });
  assert.equal(result.apr7d, null);
  assert.match(result.reason ?? "", /younger than 7 days/);
});

test("APR is pool-level fee income only — no IL, price or incentive terms", () => {
  const result = computeApr24h({
    volume24hUsd: 100_000,
    liquidityUsd: 500_000,
    feeRate: 0.003,
    feeSource: "detail_api",
    poolCreatedAt: OLD_POOL,
    now: NOW,
  });
  assert.match(result.method, /24h volume/);
  assert.doesNotMatch(result.method, /impermanent|incentive|\bIL\b|gas|rebalanc/i);
});
// ---- collector page rotation -------------------------------------------------

test("page rotation walks every page before repeating one", () => {
  const pages = new Set<number>();
  const start = new Date("2026-10-13T00:00:00Z");
  for (let i = 0; i < 10; i++) {
    pages.add(rotatingStartPage(10, new Date(start.getTime() + i * 10 * 60_000)));
  }
  assert.equal(pages.size, 10, "a 10-run cycle must cover all 10 pages");
});

test("page rotation is stable within a window and never out of range", () => {
  const t = new Date("2026-10-13T00:03:00Z");
  assert.equal(rotatingStartPage(10, t), rotatingStartPage(10, new Date(t.getTime() + 60_000)));
  for (let i = 0; i < 50; i++) {
    const page = rotatingStartPage(10, new Date(t.getTime() + i * 37 * 60_000));
    assert.ok(page >= 1 && page <= 10, `page ${page} out of range`);
  }
});

test("single-page config always starts at page 1", () => {
  assert.equal(rotatingStartPage(1, new Date()), 1);
});

// ---- valuation sanity --------------------------------------------------------

test("market cap larger than FDV is rejected rather than displayed", () => {
  // Real upstream pair observed on Arc: $72.68B "market cap" vs $0.51B FDV.
  const result = sanitizeValuation(72_680_000_000, 510_000_000);
  assert.equal(result.marketCapUsd, null);
  assert.equal(result.fdvUsd, null);
  assert.match(result.reason ?? "", /exceeds its own FDV/);
});

test("a market cap below FDV is kept with no caveat", () => {
  const result = sanitizeValuation(400_000_000, 444_000_000);
  assert.equal(result.marketCapUsd, 400_000_000);
  assert.equal(result.fdvUsd, 444_000_000);
  assert.equal(result.reason, null);
});

test("a mildly-above-FDV market cap is kept but flagged, not discarded", () => {
  // Real cirbtc case: $517M cap vs $444M FDV — believable, likely an upstream
  // supply mismatch. Discarding it would lose a correct headline number.
  const result = sanitizeValuation(515_000_000, 444_000_000);
  assert.equal(result.marketCapUsd, 515_000_000);
  assert.match(result.reason ?? "", /sits above the reported FDV/);
});

test("missing FDV leaves a standalone market cap intact", () => {
  const result = sanitizeValuation(12_000_000, null);
  assert.equal(result.marketCapUsd, 12_000_000);
  assert.equal(result.fdvUsd, null);
  assert.equal(result.reason, null);
});

test("zero values are treated as unknown, never as a real valuation", () => {
  assert.equal(sanitizeValuation(0, 0).marketCapUsd, null);
  assert.equal(sanitizeValuation(null, 0).fdvUsd, null);
});
