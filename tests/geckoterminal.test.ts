/**
 * Regression guard for the GeckoTerminal network-prefix bug.
 *
 * GeckoTerminal returns resource ids as "arc_0xabc…", but its per-token
 * endpoint rejects that form with HTTP 404 (verified live: bare address -> 200,
 * prefixed -> 404). Addresses were previously stored verbatim, so 205 of 237
 * token rows could never be enriched — market-cap coverage sat at ~5% even
 * though the data was reachable.
 *
 * These tests pin the normalization contract rather than re-testing the vendor.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { stripNetworkPrefix } from "../src/server/types.ts";
import { percentToFraction, parseFeeFromName } from "../src/server/sources/geckoterminal.ts";

describe("GeckoTerminal network prefix normalization", () => {
  it("strips the arc_ prefix so the token endpoint accepts the address", () => {
    const bare = "0x171a4217b86a807a64eb94757db6849fb4bdbaa0";
    assert.equal(stripNetworkPrefix(`arc_${bare}`), bare);
  });

  it("is idempotent, so double-stripping cannot corrupt an address", () => {
    const bare = "0x171a4217b86a807a64eb94757db6849fb4bdbaa0";
    assert.equal(stripNetworkPrefix(stripNetworkPrefix(`arc_${bare}`)), bare);
  });

  it("lowercases, matching the casing used for pool identity", () => {
    assert.equal(
      stripNetworkPrefix("ARC_0x171A4217B86A807A64EB94757DB6849FB4BDBAA0"),
      "0x171a4217b86a807a64eb94757db6849fb4bdbaa0",
    );
  });

  it("leaves an already-bare address untouched", () => {
    const bare = "0x171a4217b86a807a64eb94757db6849fb4bdbaa0";
    assert.equal(stripNetworkPrefix(bare), bare);
  });

  it("does not mangle a bytes32 v4 pool id", () => {
    const bytes32 = `0x${"a".repeat(64)}`;
    assert.equal(stripNetworkPrefix(bytes32), bytes32);
  });
});

describe("GeckoTerminal fee parsing (unchanged, pinned against regressions)", () => {
  it("treats pool_fee_percentage as a percent, not a fraction", () => {
    assert.equal(percentToFraction("1"), 0.01);
    assert.equal(percentToFraction("0.3"), 0.003);
  });

  it("rejects an out-of-range percent rather than inventing a fee", () => {
    assert.equal(percentToFraction("150"), null);
    assert.equal(percentToFraction(null), null);
  });

  it("reads the fee tier out of the pool name as a fallback", () => {
    assert.equal(parseFeeFromName("cirbtc / USDC 0.01%"), 0.0001);
    assert.equal(parseFeeFromName("cirbtc / USDC"), null);
  });
});