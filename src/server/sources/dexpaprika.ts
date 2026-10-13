/**
 * DexPaprika adapter — discovery + cross-validation only.
 *
 * Verified live:
 *  - GET /networks/arc/pools now returns `{"error":"endpoint_removed"}`;
 *    the working listing is /networks/arc/pools/search (order_by=liquidity_usd).
 *  - The keyless tier is credit-limited ("Register for a free API key…"), so
 *    this adapter must never block the primary sync.
 *  - `fee` is null even for Uniswap v3 pools, and volume_24h can be 0 while
 *    volume_7d is populated — therefore DexPaprika is NOT trusted for fees and
 *    only fills fields GeckoTerminal cannot provide (7d volume, creation time).
 */
import { fetchJson, positive, toNumber } from "../http";
import {
  ARC_CHAIN_ID,
  canonicalDexId,
  type DiscoveredPool,
  type IdentifierKind,
} from "../types";

const BASE = "https://api.dexpaprika.com";
const MIN_INTERVAL_MS = Number(process.env.DEXPAPRIKA_MIN_INTERVAL_MS ?? 3000);
/** Keyless quota is small; stop well before it is exhausted. */
const MAX_PAGES = Number(process.env.DEXPAPRIKA_MAX_PAGES ?? 4);
const PAGE_SIZE = 100;

type DpToken = { id: string; symbol?: string; name?: string };

type DpPool = {
  id: string;
  dex_id: string;
  dex_name: string;
  chain: string;
  liquidity_usd?: number | null;
  volume_usd_24h?: number | null;
  volume_usd_7d?: number | null;
  price_usd?: number | null;
  created_at?: string | null;
  fee?: number | null;
  base_token_id?: string;
  quote_token_id?: string;
  tokens?: DpToken[];
};

type DpSearchResponse = {
  results?: DpPool[];
  error?: string;
  message?: string;
  retry_after?: number;
};

function header(): Record<string, string> {
  const key = process.env.DEXPAPRIKA_API_KEY;
  return key ? { "x-api-key": key } : {};
}

/**
 * DexPaprika returns a bytes32 pool id for Uniswap v4 pools (66 hex chars,
 * no address on-chain). Identity must not assume every pool has an address.
 */
function classify(identifier: string): { identifier: string; kind: IdentifierKind } {
  const lower = identifier.toLowerCase();
  return { identifier: lower, kind: lower.length === 66 ? "bytes32" : "address" };
}

/**
 * DexPaprika reports the zero address (and sometimes the 0xEeee… sentinel) for
 * the native side of a pool, which would render as "0x0000…0000 / USDC".
 * Treating those as "token not identified" keeps the pool (it carries real
 * liquidity) without inventing a token identity.
 */
function isPlaceholderToken(address: string | undefined | null): boolean {
  if (!address) return true;
  const a = address.toLowerCase();
  return /^0x0{40}$/.test(a) || /^0xe{40}$/.test(a);
}

function toPool(pool: DpPool, fetchedAt: string): DiscoveredPool | null {
  if (!pool.id || pool.chain !== "arc") return null;
  const { identifier, kind } = classify(pool.id);
  const tokens = pool.tokens ?? [];
  const base = tokens[0];
  const quote = tokens[1];
  const dexId = canonicalDexId(pool.dex_id ?? "unknown");

  return {
    chainId: ARC_CHAIN_ID,
    dexId,
    dexName: pool.dex_name ?? dexId,
    dexVersion: dexId.includes("v4") ? "v4" : dexId.includes("v3") ? "v3" : dexId.includes("v2") ? "v2" : "unknown",
    poolIdentifier: identifier,
    identifierKind: kind,
    baseSymbol: isPlaceholderToken(base?.id) ? null : (base?.symbol ?? null),
    baseTokenAddress: isPlaceholderToken(base?.id)
      ? null
      : (base?.id?.toLowerCase() ?? pool.base_token_id?.toLowerCase() ?? null),
    quoteSymbol: isPlaceholderToken(quote?.id) ? null : (quote?.symbol ?? null),
    quoteTokenAddress: isPlaceholderToken(quote?.id)
      ? null
      : (quote?.id?.toLowerCase() ?? pool.quote_token_id?.toLowerCase() ?? null),
    feeTierLabel: toNumber(pool.fee) !== null ? `${pool.fee}%` : null,
    poolCreatedAt: pool.created_at ?? null,
    liquidityUsd: positive(pool.liquidity_usd),
    volume24hUsd: positive(pool.volume_usd_24h),
    volume7dUsd: positive(pool.volume_usd_7d),
    priceUsd: positive(pool.price_usd),
    priceChange24h: null,
    marketCapUsd: null,
    fdvUsd: null,
    // DexPaprika reports null fees for Arc pools — never guess from 0.30%.
    feeRate: null,
    feeSource: "unknown",
    source: "dexpaprika",
    updatedAt: fetchedAt,
  };
}

/**
 * Best-effort discovery pass. Any failure returns an empty list rather than
 * throwing, because the GT pass alone can still produce a complete ranking.
 */
export async function discoverPools(): Promise<{
  pools: DiscoveredPool[];
  error: string | null;
  truncated: boolean;
}> {
  const pools = new Map<string, DiscoveredPool>();
  let truncated = false;
  let lastError: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${BASE}/networks/arc/pools/search?order_by=liquidity_usd&sort=desc&limit=${PAGE_SIZE}&page=${page}`;
    try {
      const { data, fetchedAt } = await fetchJson<DpSearchResponse>(url, {
        minIntervalMs: MIN_INTERVAL_MS,
        retries: 2,
        headers: header(),
      });
      if (data.error) {
        lastError = `${data.error}: ${data.message ?? ""}`.trim();
        break;
      }
      const results = data.results ?? [];
      for (const pool of results) {
        const normalized = toPool(pool, fetchedAt);
        if (!normalized) continue;
        const key = `${normalized.chainId}:${normalized.dexId}:${normalized.poolIdentifier}`;
        pools.set(key, normalized);
      }
      if (results.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) truncated = true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  return { pools: [...pools.values()], error: lastError, truncated };
}