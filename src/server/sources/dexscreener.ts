/**
 * DexScreener adapter for refreshing pools ArcPools already knows about.
 *
 * The API is keyless and accepts up to 30 comma-separated pool ids per call.
 * It is not a discovery source and exposes no LP fee or 7-day volume, so this
 * adapter only returns the fields it actually measured.
 */
import { fetchJson, positive, toNumber, type RequestOptions } from "../http";

const BASE = "https://api.dexscreener.com/latest/dex/pairs/arc";
const BATCH_SIZE = 30;
const MIN_INTERVAL_MS = Number(process.env.DEXSCREENER_MIN_INTERVAL_MS ?? 250);

type DsPair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
  quoteToken?: { address?: string | null; name?: string | null; symbol?: string | null } | null;
  priceUsd?: string | number | null;
  priceChange?: { h24?: number | null } | null;
  volume?: { h24?: number | null } | null;
  liquidity?: { usd?: number | null } | null;
  fdv?: number | null;
  marketCap?: number | null;
  pairCreatedAt?: number | null;
};

type DsResponse = { pairs?: DsPair[] | null };

export type DexScreenerMetrics = {
  poolIdentifier: string;
  baseTokenAddress: string | null;
  baseTokenName: string | null;
  baseTokenSymbol: string | null;
  quoteTokenAddress: string | null;
  quoteTokenName: string | null;
  quoteTokenSymbol: string | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  poolCreatedAt: string | null;
  updatedAt: string;
};

export type DexScreenerFetchResult = {
  metrics: Map<string, DexScreenerMetrics>;
  requests: number;
  errors: string[];
};

function creationTime(value: number | null | undefined): string | null {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseDexScreenerPairs(
  pairs: DsPair[] | null | undefined,
  fetchedAt: string,
): Map<string, DexScreenerMetrics> {
  const metrics = new Map<string, DexScreenerMetrics>();
  for (const pair of pairs ?? []) {
    const identifier = pair.pairAddress?.toLowerCase();
    if (!identifier || pair.chainId?.toLowerCase() !== "arc") continue;
    metrics.set(identifier, {
      poolIdentifier: identifier,
      baseTokenAddress: pair.baseToken?.address?.toLowerCase() ?? null,
      baseTokenName: pair.baseToken?.name ?? null,
      baseTokenSymbol: pair.baseToken?.symbol ?? null,
      quoteTokenAddress: pair.quoteToken?.address?.toLowerCase() ?? null,
      quoteTokenName: pair.quoteToken?.name ?? null,
      quoteTokenSymbol: pair.quoteToken?.symbol ?? null,
      liquidityUsd: positive(pair.liquidity?.usd),
      volume24hUsd: positive(pair.volume?.h24),
      priceUsd: positive(pair.priceUsd),
      priceChange24h: toNumber(pair.priceChange?.h24),
      marketCapUsd: positive(pair.marketCap),
      fdvUsd: positive(pair.fdv),
      poolCreatedAt: creationTime(pair.pairCreatedAt),
      updatedAt: fetchedAt,
    });
  }
  return metrics;
}

export async function fetchDexScreenerMetrics(
  poolIdentifiers: string[],
  options: Pick<RequestOptions, "fetcher" | "retries"> & { minIntervalMs?: number } = {},
): Promise<DexScreenerFetchResult> {
  const unique = [...new Set(poolIdentifiers.map((id) => id.toLowerCase()).filter(Boolean))];
  const metrics = new Map<string, DexScreenerMetrics>();
  const errors: string[] = [];
  let requests = 0;

  for (let offset = 0; offset < unique.length; offset += BATCH_SIZE) {
    const batch = unique.slice(offset, offset + BATCH_SIZE);
    requests++;
    try {
      const { data, fetchedAt } = await fetchJson<DsResponse>(`${BASE}/${batch.join(",")}`, {
        minIntervalMs: options.minIntervalMs ?? MIN_INTERVAL_MS,
        retries: options.retries ?? 2,
        fetcher: options.fetcher,
      });
      for (const [identifier, row] of parseDexScreenerPairs(data.pairs, fetchedAt)) {
        metrics.set(identifier, row);
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { metrics, requests, errors };
}
