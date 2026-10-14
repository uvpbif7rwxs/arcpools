#!/usr/bin/env node
import { dbFilePath, getDb } from "../src/server/db.ts";
import {
  refreshKnownPoolsFromDexScreener,
  refreshMissingVolumesFromGeckoTerminal,
} from "../src/server/sync.ts";

console.log(`[dexscreener] db=${dbFilePath()}`);
const result = await refreshKnownPoolsFromDexScreener();
console.log(`[dexscreener] requests=${result.requests} matched=${result.matched}`);
console.log(
  `[dexscreener] updated=${result.updated} identities=${result.identitiesUpdated} filled_liquidity=${result.filledLiquidity} filled_volume_24h=${result.filledVolume24h} mcap=${result.marketCapsUpdated} refreshed_stale=${result.refreshedStale}`,
);
for (const error of result.errors) console.log(`  ! ${error}`);
const missingVolume = await refreshMissingVolumesFromGeckoTerminal();
console.log(
  `[geckoterminal-detail] attempted=${missingVolume.attempted} updated=${missingVolume.updated}`,
);
for (const error of missingVolume.errors) console.log(`  ! ${error}`);
getDb().close();
