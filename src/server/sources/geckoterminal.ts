/**
 * GeckoTerminal adapter — primary source for Arc pools.
 *
 * Verified live against https://api.geckoterminal.com/api/v2/networks/arc/pools:
 *  - the LIST endpoint returns reserve_in_usd, volume_usd.h24/h7d, market_cap_usd,
 *    fdv_usd and pool_created_at, but NOT pool_fee_percentage;
 *  - pool_fee_percentage only appears on the single-pool DETAIL endpoint;
 *  - keyless tier rate-limits aggressively (~30 req/min), so requests are
 *    throttled here and fee lookups are budgeted separately.
 */
import { fetchJson, positive, toNumber } from "../http";
import {
  ARC_CHAIN_ID,
  ARC_NETWORK_ID,
  canonicalDexId,
  type DiscoveredPool,
  type PoolIdentity,
  type PoolMetrics,
} from "../types";

const BASE = "https://api.geckoterminal.com/api/v2";
/** Measured behaviour: 20 pools per page; stay under the keyless tier. */
const MIN_INTERVAL_MS = Number(process.env.GT_MIN_INTERVAL_MS ?? 2200);
/**
 * Verified live: the keyless tier rejects page > 10 with HTTP 401
 * ("Your request exceeds the allowed max number for page (10)"), capping
 * discoverable coverage at 20 x 10 = 200 pools per sync. Surfaced in the UI as
 * a coverage note instead of being silently hidden.
 */
export const GT_MAX_PAGE = Number(process.env.GT_MAX_PAGE ?? 10);

type GtRelationships = {
  base_token?: { data?: { id?: string } };
  quote_token?: { data?: { id?: string } };
  dex?: { data?: { id?: string } };
  dex_version?: { data?: { id?: string } };
};

type GtPoolResource = {
  id: string; // "arc_0x…" or "arc_0x<bytes32>" for v4 pools
  attributes?: Record<string, unknown>;
  relationships?: GtRelationships;
};

/** Single-resource shape returned by the pool/token detail endpoints. */
type GtSingleResponse = {
  data?: GtPoolResource;
  errors?: { code: number; title: string; detail?: string }[];
};

type GtListResponse = {
  data?: GtPoolResource[];
  included?: { id: string; type: string; attributes?: Record<string, unknown> }[];
  errors?: { code: number; title: string; detail?: string }[];
};

function header(): Record<string, string> {
  const key = process.env.GECKOTERMINAL_API_KEY;
  return key ? { "x-cg-pro-api-key": key } : {};
}

/** "0x…" length check distinguishes a 20-byte address from a bytes32 pool id. */
function classifyIdentifier(raw: string): {
  identifier: string;
  kind: "address" | "bytes32";
} {
  const identifier = raw.toLowerCase();
  const kind = identifier.length === 66 ? "bytes32" : "address";
  return { identifier, kind };
}

/**
 * GeckoTerminal returns `pool_fee_percentage` as a PERCENT ("1" = 1%, i.e. a
 * 0.01 fee fraction). Normalize to the fraction convention used internally.
 */
export function percentToFraction(value: unknown): number | null {
  const pct = positive(value);
  if (pct === null || pct > 100) return null;
  return pct / 100;
}

export function parseFeeFromName(name: string | null): number | null {
  if (!name) return null;
  // GT encodes the fee tier in the pool name, e.g. "cirbtc / USDC 0.01%".
  const match = name.match(/(\d+(?:\.\d+)?)%\s*$/);
  if (!match) return null;
  const pct = Number(match[1]);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null;
  return pct / 100;
}

function versionOf(dexId: string, dexVersionId: string | undefined): PoolIdentity["dexVersion"] {
  const fromRel = (dexVersionId ?? "").toLowerCase();
  if (fromRel.includes("v4")) return "v4";
  if (fromRel.includes("v3")) return "v3";
  if (fromRel.includes("v2")) return "v2";
  const fromDex = dexId.toLowerCase();
  if (fromDex.includes("v4")) return "v4";
  if (fromDex.includes("v3")) return "v3";
  if (fromDex.includes("v2")) return "v2";
  return "unknown";
}

function dexIdOf(relationshipId: string | undefined, identifier: string): string {
  const raw = (relationshipId ?? "").toLowerCase();
  if (raw) return canonicalDexId(raw.replace(`${ARC_NETWORK_ID}_`, "").replace(/^arc[-_]/, ""));
  if (identifier.length === 66) return "uniswap_v4";
  return "unknown";
}

function toIdentity(
  pool: GtPoolResource,
  included: Map<string, Record<string, unknown>>,
): PoolIdentity | null {
  const attributes = pool.attributes ?? {};
  const rawId = pool.id.startsWith(`${ARC_NETWORK_ID}_`)
    ? pool.id.slice(ARC_NETWORK_ID.length + 1)
    : pool.id.replace(/^arc[-_]/, "");
  if (!rawId.startsWith("0x")) return null;

  const { identifier, kind } = classifyIdentifier(rawId);
  const relationships = pool.relationships ?? {};
  const baseAddress = relationships.base_token?.data?.id
    ? String(relationships.base_token.data.id).toLowerCase()
    : null;
  const quoteAddress = relationships.quote_token?.data?.id
    ? String(relationships.quote_token.data.id).toLowerCase()
    : null;

  const dexId = dexIdOf(relationships.dex?.data?.id, identifier);
  const dexName =
    (included.get(String(relationships.dex?.data?.id ?? ""))?.name as string | undefined) ??
    dexId;
  const poolName = (attributes.pool_name as string | undefined) ?? null;
  const displayName = (attributes.name as string | undefined) ?? poolName;
  const feeTierLabel = displayName?.match(/(\d+(?:\.\d+)?)\s*%\s*$/)?.[0]?.trim() ?? null;

  // "cirbtc / USDC" -> base cirbtc, quote USDC. GT order is base/quote.
  const [basePart, quotePart] = (poolName ?? displayName ?? "").split("/").map((p) => p.trim());
  const baseSymbol = basePart || null;
  const quoteSymbol = quotePart?.split(/\s+/)[0] || null;

  const baseMeta = baseAddress ? included.get(baseAddress) : undefined;
  const quoteMeta = quoteAddress ? included.get(quoteAddress) : undefined;

  const created = (attributes.pool_created_at as string | undefined) ?? null;

  return {
    chainId: ARC_CHAIN_ID,
    dexId,
    dexName,
    dexVersion: versionOf(dexId, relationships.dex_version?.data?.id),
    poolIdentifier: identifier,
    identifierKind: kind,
    baseSymbol: (baseMeta?.symbol as string | undefined) ?? baseSymbol,
    baseTokenAddress: baseAddress,
    quoteSymbol: (quoteMeta?.symbol as string | undefined) ?? quoteSymbol,
    quoteTokenAddress: quoteAddress,
    feeTierLabel,
    poolCreatedAt: created && !Number.isNaN(Date.parse(created)) ? created : null,
  };
}

function toMetrics(
  attributes: Record<string, unknown>,
  poolName: string | null,
  source: string,
  updatedAt: string,
): PoolMetrics {
  const volume = (attributes.volume_usd ?? {}) as Record<string, unknown>;
  const change = (attributes.price_change_percentage ?? {}) as Record<string, unknown>;

  // Detail endpoint supplies the real fee (as a percent); the list endpoint does not.
  const detailFee = percentToFraction(attributes.pool_fee_percentage);
  const nameFee = parseFeeFromName(poolName);
  const feeRate = detailFee ?? nameFee;

  return {
    liquidityUsd: positive(attributes.reserve_in_usd),
    volume24hUsd: positive(volume.h24),
    // GT exposes m5/m15/m30/h1/h6/h24 buckets only — no 7d window. Left null so
    // that DexPaprika (which does report 7d) is the only source claiming 7d data.
    volume7dUsd: null,
    priceUsd: positive(attributes.base_token_price_usd),
    priceChange24h: toNumber(change.h24),
    marketCapUsd: positive(attributes.market_cap_usd),
    fdvUsd: positive(attributes.fdv_usd),
    feeRate,
    feeSource: detailFee ? "detail_api" : nameFee ? "pool_name" : "unknown",
    source,
    updatedAt,
  };
}

export async function fetchPoolsPage(
  page: number,
  opts: { includeTokens?: boolean } = {},
): Promise<{ pools: DiscoveredPool[]; hasMore: boolean; fetchedAt: string }> {
  const include = opts.includeTokens === false ? "" : "&include=base_token,quote_token,dex";
  const { data, fetchedAt } = await fetchJson<GtListResponse>(
    `${BASE}/networks/${ARC_NETWORK_ID}/pools?page=${page}${include}`,
    { minIntervalMs: MIN_INTERVAL_MS, headers: header() },
  );

  if (data.errors?.length) {
    throw new Error(`geckoterminal error: ${data.errors[0].detail ?? data.errors[0].title}`);
  }
  const resources = data.data ?? [];
  const included = new Map(
    (data.included ?? []).map((item) => [String(item.id).toLowerCase(), item.attributes ?? {}]),
  );

  const pools: DiscoveredPool[] = [];
  for (const resource of resources) {
    const identity = toIdentity(resource, included);
    if (!identity) continue;
    const attributes = resource.attributes ?? {};
    const name = (attributes.pool_name as string | undefined) ?? (attributes.name as string | undefined) ?? null;
    pools.push({
      ...identity,
      ...toMetrics(attributes, name, "geckoterminal", fetchedAt),
    });
  }

  return { pools, hasMore: resources.length >= 20 && page < GT_MAX_PAGE, fetchedAt };
}

/**
 * Fee is only on the detail endpoint. Budgeted by the caller because each call
 * costs one slot of the keyless quota.
 */
export async function fetchPoolDetail(
  identifier: string,
): Promise<{
  feeRate: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  poolCreatedAt: string | null;
  updatedAt: string;
} | null> {
  const { data, fetchedAt } = await fetchJson<GtSingleResponse>(
    `${BASE}/networks/${ARC_NETWORK_ID}/pools/${identifier}`,
    { minIntervalMs: MIN_INTERVAL_MS, retries: 2, headers: header() },
  );
  const resource = data.data;
  if (!resource?.attributes) return null;
  const attributes = resource.attributes;
  const volume = (attributes.volume_usd ?? {}) as Record<string, unknown>;
  return {
    feeRate: percentToFraction(attributes.pool_fee_percentage),
    liquidityUsd: positive(attributes.reserve_in_usd),
    volume24hUsd: positive(volume.h24),
    // No 7d window upstream; kept null on purpose.
    volume7dUsd: null,
    marketCapUsd: positive(attributes.market_cap_usd),
    fdvUsd: positive(attributes.fdv_usd),
    poolCreatedAt: (attributes.pool_created_at as string | undefined) ?? null,
    updatedAt: fetchedAt,
  };
}

/**
 * Token metadata for pools discovered through DexPaprika: its search endpoint
 * returns token ids only (no symbol/name), which would leave rows with blank
 * pair names. Budgeted by the caller — one rate-limit slot per token.
 */
export async function fetchTokenMetadata(
  address: string,
): Promise<{
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  imageUrl: string | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
} | null> {
  const { data } = await fetchJson<GtSingleResponse>(
    `${BASE}/networks/${ARC_NETWORK_ID}/tokens/${address}`,
    { minIntervalMs: MIN_INTERVAL_MS, retries: 2, headers: header() },
  );
  const attributes = data.data?.attributes;
  if (!attributes) return null;
  return {
    address,
    name: (attributes.name as string | undefined) ?? null,
    symbol: (attributes.symbol as string | undefined) ?? null,
    decimals: typeof attributes.decimals === "number" ? attributes.decimals : null,
    imageUrl: (attributes.image_url as string | undefined) ?? null,
    marketCapUsd: positive(attributes.market_cap_usd),
    fdvUsd: positive(attributes.fdv_usd),
  };
}

export async function fetchDexes(): Promise<{ id: string; name: string }[]> {
  const { data } = await fetchJson<GtListResponse>(
    `${BASE}/networks/${ARC_NETWORK_ID}/dexes`,
    { minIntervalMs: MIN_INTERVAL_MS, headers: header() },
  );
  return (data.data ?? []).map((d) => ({
    id: d.id.replace(`${ARC_NETWORK_ID}_`, ""),
    name: String((d.attributes?.name as string | undefined) ?? d.id),
  }));
}