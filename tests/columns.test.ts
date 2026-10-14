/**
 * Column-order regression test.
 *
 * The header row and the body rows are generated in two different files, so
 * nothing in the type system stops one from being reordered without the other.
 * That happened during a redesign: the header became LIQ, MCAP, APR, VOL 24H,
 * AGE while the body still rendered MCAP, AGE, APR, LIQ, VOL 24H — so every
 * market cap appeared under a "LIQ" heading and every age under "MCAP".
 *
 * These tests read the actual source and compare the orders, so the mismatch
 * fails the build rather than quietly mislabelling the leaderboard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

/** The leaderboard's display fields, in the order the product specifies. */
const EXPECTED = ["mcap", "age", "apr", "liq", "vol24h"];

test("header column order matches the leaderboard fields", () => {
  const source = read("src/components/table-chrome.tsx");
  const block = source.slice(source.indexOf("const COLUMNS"), source.indexOf("];", source.indexOf("const COLUMNS")));
  const keys = [...block.matchAll(/key:\s*"([a-z0-9]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, EXPECTED, `header order is ${keys.join(", ")}`);
});

test("header renders the metric columns in that same order", () => {
  const source = read("src/components/table-chrome.tsx");
  const start = source.indexOf("export function SortableHeader");
  // Slice to the next top-level export, not to the first closing brace — the
  // function body contains nested ones.
  const next = source.indexOf("\nexport ", start + 1);
  const body = source.slice(start, next === -1 ? source.length : next);
  assert.ok(
    body.includes("COLUMNS.map"),
    "the header must drive its metric columns from COLUMNS rather than a second hand-written list",
  );
});

test("body cell order matches the header", () => {
  const source = read("src/components/pool-row.tsx");
  const start = source.indexOf("export function PoolRowView");
  const body = source.slice(start, source.indexOf("Collapsed by default", start));

  // The metric cells, in the order they are emitted.
  const cells = [...body.matchAll(/<(McapCell|AgeCell|AprCell|td)\b/g)].map((m) => m[1]);
  const ordered = cells.filter((cell) => cell !== "td");

  // LIQ and VOL 24H are plain <td>s, so they are asserted by position instead.
  assert.deepEqual(
    ordered,
    ["McapCell", "AgeCell", "AprCell"],
    `named cells are ${ordered.join(", ")}`,
  );
  assert.ok(
    body.indexOf("row.liquidityUsd") > body.indexOf("AprCell row={row}") &&
      body.indexOf("row.volume24hUsd") > body.indexOf("row.liquidityUsd"),
    "LIQ must render before VOL 24H",
  );
});

test("every sortable header key has a matching SQL column", () => {
  const chrome = read("src/components/table-chrome.tsx");
  const queries = read("src/server/queries.ts");
  const block = chrome.slice(chrome.indexOf("const COLUMNS"), chrome.indexOf("];", chrome.indexOf("const COLUMNS")));
  const keys = [...block.matchAll(/key:\s*"([a-z0-9]+)"/g)].map((m) => m[1]);

  for (const key of keys) {
    assert.ok(
      new RegExp(`${key}:\\s*"[^"]+"`).test(queries),
      `SORTABLE in queries.ts has no entry for the "${key}" column`,
    );
  }
});
