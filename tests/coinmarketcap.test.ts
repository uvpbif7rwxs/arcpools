import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchCmcHolderCount,
  fetchCmcMarketCap,
  parseCmcHolderCount,
  parseCmcMarketCap,
} from "../src/server/sources/coinmarketcap.ts";

const ADDRESS = "0x07704b06981ea962b87296362a1281484d160000";

describe("CoinMarketCap keyless DEX parsing", () => {
  it("parses ARCAT-style market cap and holder envelopes", () => {
    assert.equal(
      parseCmcMarketCap(
        { data: { addr: ADDRESS, mcap: "84515.775" }, status: { error_code: "0" } },
        ADDRESS,
      ),
      84515.775,
    );
    assert.equal(
      parseCmcHolderCount(
        { data: { tokenAddress: ADDRESS, count: "6694" }, status: { error_code: "0" } },
        ADDRESS,
      ),
      6694,
    );
  });

  it("rejects mismatched addresses and invalid holder counts", () => {
    assert.equal(
      parseCmcMarketCap({ data: { addr: "0xdead", mcap: 100 } }, ADDRESS),
      null,
    );
    assert.equal(
      parseCmcHolderCount({ data: { tokenAddress: ADDRESS, count: "1.5" } }, ADDRESS),
      null,
    );
  });

  it("uses the documented keyless paths without an API-key header", async () => {
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      urls.push(String(input));
      assert.equal(new Headers(init?.headers).has("X-CMC_PRO_API_KEY"), false);
      const body = String(input).includes("holders/count")
        ? { data: { tokenAddress: ADDRESS, count: "6694" }, status: { error_code: "0" } }
        : { data: { addr: ADDRESS, mcap: "84515.775" }, status: { error_code: "0" } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    assert.equal(
      (await fetchCmcMarketCap(ADDRESS, { fetcher, retries: 0, minIntervalMs: 0 }))
        .marketCapUsd,
      84515.775,
    );
    assert.equal(
      (await fetchCmcHolderCount(ADDRESS, { fetcher, retries: 0, minIntervalMs: 0 }))
        .holdersCount,
      6694,
    );
    assert.ok(urls.every((url) => url.includes("/public-api/")));
  });
});
