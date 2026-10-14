import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fetchDexScreenerMetrics,
  parseDexScreenerPairs,
} from "../src/server/sources/dexscreener.ts";

test("DexScreener parser keeps measured fields and treats zero as unknown", () => {
  const rows = parseDexScreenerPairs(
    [
      {
        chainId: "arc",
        pairAddress: "0xABC",
        baseToken: { address: "0xBEEF", name: "Base token", symbol: "BASE" },
        quoteToken: { address: "0xCAFE", name: "Quote token", symbol: "QUOTE" },
        priceUsd: "1.25",
        priceChange: { h24: 0 },
        volume: { h24: 500 },
        liquidity: { usd: 0 },
        fdv: 900,
        marketCap: 800,
        pairCreatedAt: 1_700_000_000_000,
      },
      { chainId: "base", pairAddress: "0xDEF", liquidity: { usd: 100 } },
    ],
    "2026-10-14T00:00:00.000Z",
  );

  assert.equal(rows.size, 1);
  assert.deepEqual(rows.get("0xabc"), {
    poolIdentifier: "0xabc",
    baseTokenAddress: "0xbeef",
    baseTokenName: "Base token",
    baseTokenSymbol: "BASE",
    quoteTokenAddress: "0xcafe",
    quoteTokenName: "Quote token",
    quoteTokenSymbol: "QUOTE",
    liquidityUsd: null,
    volume24hUsd: 500,
    priceUsd: 1.25,
    priceChange24h: 0,
    marketCapUsd: 800,
    fdvUsd: 900,
    poolCreatedAt: "2023-11-14T22:13:20.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  });
});

test("DexScreener batches at 30 pool ids and keeps partial successes", async () => {
  const ids = Array.from({ length: 31 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`);
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    if (calls === 2) return new Response("unavailable", { status: 503 });
    return new Response(
      JSON.stringify({
        pairs: [
          {
            chainId: "arc",
            pairAddress: ids[0],
            liquidity: { usd: 1234 },
            volume: { h24: 567 },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await fetchDexScreenerMetrics(ids, {
    fetcher,
    minIntervalMs: 0,
    retries: 0,
  });
  assert.equal(result.requests, 2);
  assert.equal(result.metrics.size, 1);
  assert.equal(result.metrics.get(ids[0])?.liquidityUsd, 1234);
  assert.equal(result.errors.length, 1);
});
