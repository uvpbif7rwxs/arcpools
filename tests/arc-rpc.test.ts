import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeAbiString, fetchTokenSymbol } from "../src/server/sources/arc-rpc.ts";

test("decodes dynamic and bytes32 ERC-20 symbols", () => {
  const dynamic =
    "0x" +
    "20".padStart(64, "0") +
    "4".padStart(64, "0") +
    Buffer.from("SHIF").toString("hex").padEnd(64, "0");
  const bytes32 = `0x${Buffer.from("USDC").toString("hex").padEnd(64, "0")}`;
  assert.equal(decodeAbiString(dynamic), "SHIF");
  assert.equal(decodeAbiString(bytes32), "USDC");
});

test("calls symbol() through Arc RPC", async () => {
  const encoded =
    "0x" +
    "20".padStart(64, "0") +
    "7".padStart(64, "0") +
    Buffer.from("JIMOTHY").toString("hex").padEnd(64, "0");
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.match(String(init?.body), /95d89b41/);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: encoded }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  assert.equal(
    await fetchTokenSymbol("0xee773d671f4b8c3ad0a3ab7ce34f213c4f1fd834", fetcher),
    "JIMOTHY",
  );
});
