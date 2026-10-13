#!/usr/bin/env node
/**
 * `npm run sync` — runs the full pipeline once and prints a summary.
 *
 * Usage:
 *   npm run sync                 # default: 10 pages, 30 fee detail calls
 *   npm run sync -- --pages=4    # faster local pass
 *   npm run sync -- --pages=10 --detail=0 --no-crosscheck
 */
import { runSync } from "../src/server/sync.ts";
import { getDb, dbFilePath } from "../src/server/db.ts";
import { getStats } from "../src/server/queries.ts";

function arg(name: string, fallback?: number): number | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const n = Number(hit.split("=")[1]);
  return Number.isFinite(n) ? n : fallback;
}

const maxPages = arg("pages");
const detailBudget = arg("detail");
const crossCheck = !process.argv.includes("--no-crosscheck");

console.log(`[sync] db=${dbFilePath()}`);
const startPage = arg("start");
console.log(
  `[sync] pages=${maxPages ?? "auto"} start=${startPage ?? "auto(rotating)"} detail=${detailBudget ?? "auto"} crossCheck=${crossCheck}`,
);

const started = Date.now();
const result = await runSync({
  maxPages,
  detailBudget,
  startPage,
  crossCheck,
});

console.log(`\n[sync] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`  pages fetched      : ${result.pagesFetched} (rotating start page ${result.startPage})`);
console.log(`  pools discovered   : ${result.discovered}`);
console.log(`  rows upserted      : ${result.upserted}`);
console.log(`  fee detail calls   : ${result.detailCalls}`);
console.log(`  pools with flags   : ${result.flagged}`);
console.log(`  cross-check pools  : ${result.crossCheck.pools}${result.crossCheck.error ? ` (error: ${result.crossCheck.error})` : ""}`);

for (const warning of result.warnings) console.log(`  ! ${warning}`);

const stats = getStats();
console.log("\n[stats]");
console.log(`  tracked pools      : ${stats.trackedPools}`);
console.log(`  tracked liquidity  : ${stats.trackedLiquidityUsd?.toFixed(0) ?? "N/A"}`);
console.log(`  tracked 24h volume : ${stats.trackedVolume24hUsd?.toFixed(0) ?? "N/A"}`);
console.log(`  pools with APR     : ${stats.poolsWithApr}`);
console.log(`  stale pools        : ${stats.stalePools}`);
console.log(`  dexes              : ${stats.dexes.map((d) => `${d.id}(${d.pools})`).join(", ")}`);

getDb().close();