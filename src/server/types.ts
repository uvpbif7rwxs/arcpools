/**
 * Domain types shared by adapters, normalization, APR math and queries.
 *
 * Every optional field is `null` when unknown. Nothing in this project invents
 * a value: a missing upstream field stays missing all the way to the UI,
 * which renders it as N/A plus a reason.
 */

export const ARC_CHAIN_ID = 5042;
export const ARC_NETWORK_ID = "arc";

export type IdentifierKind = "address" | "bytes32";

export type PoolIdentity = {
  chainId: number;
  dexId: string;
  dexName: string;
  dexVersion: "v2" | "v3" | "v4" | "unknown";
  /** Lowercased pool address (v2/v3) or bytes32 pool id (v4). */
  poolIdentifier: string;
  identifierKind: IdentifierKind;
  baseSymbol: string | null;
  baseTokenAddress: string | null;
  quoteSymbol: string | null;
  quoteTokenAddress: string | null;
  feeTierLabel: string | null;
  /** On-chain creation timestamp. Never substituted by first_seen_at. */
  poolCreatedAt: string | null;
};

export type PoolMetrics = {
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  /** Effective LP fee fraction, e.g. 0.003. Null = unknown => APR is N/A. */
  feeRate: number | null;
  feeSource: "detail_api" | "pool_name" | "unknown";
  source: string;
  updatedAt: string;
};

export type DiscoveredPool = PoolIdentity & PoolMetrics;

export type PoolFlag = {
  flag: string;
  detail: string | null;
};

export type AprResult = {
  apr24h: number | null;
  apr7d: number | null;
  method: string;
  confidence: "verified" | "estimated" | "low_history" | "na";
  reason: string | null;
};

export type PoolRow = {
  poolKey: string;
  chainId: number;
  dexId: string;
  dexName: string | null;
  dexVersion: string | null;
  poolIdentifier: string;
  identifierKind: string;
  baseSymbol: string | null;
  baseTokenAddress: string | null;
  quoteSymbol: string | null;
  quoteTokenAddress: string | null;
  feeTierLabel: string | null;
  poolCreatedAt: string | null;
  firstSeenAt: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  feeRate: number | null;
  feeSource: string | null;
  apr24h: number | null;
  apr7d: number | null;
  aprMethod: string | null;
  aprConfidence: string | null;
  aprReason: string | null;
  source: string | null;
  updatedAt: string | null;
  stale: boolean;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  holdersCount: number | null;
  flags: PoolFlag[];
};

export function poolKeyOf(identity: {
  chainId: number;
  dexId: string;
  poolIdentifier: string;
  identifierKind?: IdentifierKind;
}): string {
  return identityKeyOf(identity);
}

/**
 * Canonical DEX id.
 *
 * Verified against live Arc data: the same Uniswap V3 pool arrives from
 * GeckoTerminal as `uniswap-v3-arc` and from DexPaprika as `uniswap_v3`. Keying
 * on the raw label split one pool into two leaderboard rows and double-counted
 * its liquidity. Separators are unified and the chain suffix dropped.
 */
export function canonicalDexId(dexId: string): string {
  return dexId
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/_arc(_|$)/, "_$1")
    .replace(/^arc_/, "")
    .replace(/_+$/, "");
}

/**
 * Stable identity for a pool: chain + dex + pool identifier.
 *
 * For Uniswap v4 the identifier is a bytes32 Pool ID derived from the PoolKey,
 * so the same id reached through two different wrapper labels (peach, faze,
 * uniswap_v4) is the *same* pool. Keying those on the label alone duplicated
 * pools and inflated Tracked Liquidity. The v4 family therefore keys on the
 * Pool ID itself; the concrete wrapper is kept as display metadata and flagged.
 */
export function identityKeyOf(identity: {
  chainId: number;
  dexId: string;
  poolIdentifier: string;
  identifierKind?: IdentifierKind;
}): string {
  const dex = canonicalDexId(identity.dexId);
  const identifier = identity.poolIdentifier.toLowerCase();
  if (identity.identifierKind === "bytes32" || identifier.length === 66) {
    return `${identity.chainId}:v4pool:${identifier}`;
  }
  return `${identity.chainId}:${dex}:${identifier}`;
}

/** "0x8291…" for v2/v3 addresses, "v4:0xd0ab…" so UI and URLs stay readable. */
export function publicIdOf(poolKey: string): string {
  const [chain, dex, identifier] = poolKey.split(":");
  return `${chain}-${dex}-${identifier}`;
}