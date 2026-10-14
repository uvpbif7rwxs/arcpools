/**
 * CoinMarketCap keyless DEX endpoints used for token valuation and holder count.
 *
 * These are documented public endpoints: no API key or signup is required.
 * Arc is accepted as the platform slug and token addresses are ordinary 0x
 * contract addresses (never GeckoTerminal's `arc_` resource id).
 */
import { fetchJson, positive, toNumber, type RequestOptions } from "../http";

const BASE = "https://pro-api.coinmarketcap.com/public-api/v1/dex";
const MIN_INTERVAL_MS = Number(process.env.CMC_MIN_INTERVAL_MS ?? 300);

type CmcEnvelope<T> = {
  data?: T | null;
  status?: { error_code?: string | number; error_message?: string | null } | null;
};

type CmcTokenData = {
  addr?: string | null;
  mcap?: string | number | null;
};

type CmcHolderData = {
  tokenAddress?: string | null;
  count?: string | number | null;
};

function assertSuccess<T>(payload: CmcEnvelope<T>): T | null {
  const code = toNumber(payload.status?.error_code);
  if (code !== null && code !== 0) {
    throw new Error(payload.status?.error_message || `CoinMarketCap error ${code}`);
  }
  return payload.data ?? null;
}

export function parseCmcMarketCap(
  payload: CmcEnvelope<CmcTokenData>,
  expectedAddress: string,
): number | null {
  const data = assertSuccess(payload);
  if (!data || data.addr?.toLowerCase() !== expectedAddress.toLowerCase()) return null;
  return positive(data.mcap);
}

export function parseCmcHolderCount(
  payload: CmcEnvelope<CmcHolderData>,
  expectedAddress: string,
): number | null {
  const data = assertSuccess(payload);
  if (!data || data.tokenAddress?.toLowerCase() !== expectedAddress.toLowerCase()) return null;
  const count = toNumber(data.count);
  return count !== null && Number.isInteger(count) && count >= 0 ? count : null;
}

export async function fetchCmcMarketCap(
  address: string,
  options: Pick<RequestOptions, "fetcher" | "retries"> & { minIntervalMs?: number } = {},
): Promise<{ marketCapUsd: number | null; fetchedAt: string }> {
  const url = `${BASE}/token?platform=arc&address=${encodeURIComponent(address)}`;
  const { data, fetchedAt } = await fetchJson<CmcEnvelope<CmcTokenData>>(url, {
    minIntervalMs: options.minIntervalMs ?? MIN_INTERVAL_MS,
    retries: options.retries ?? 2,
    fetcher: options.fetcher,
  });
  return { marketCapUsd: parseCmcMarketCap(data, address), fetchedAt };
}

export async function fetchCmcHolderCount(
  address: string,
  options: Pick<RequestOptions, "fetcher" | "retries"> & { minIntervalMs?: number } = {},
): Promise<{ holdersCount: number | null; fetchedAt: string }> {
  const url = `${BASE}/holders/count?platform=arc&tokenAddress=${encodeURIComponent(address)}`;
  const { data, fetchedAt } = await fetchJson<CmcEnvelope<CmcHolderData>>(url, {
    minIntervalMs: options.minIntervalMs ?? MIN_INTERVAL_MS,
    retries: options.retries ?? 2,
    fetcher: options.fetcher,
  });
  return { holdersCount: parseCmcHolderCount(data, address), fetchedAt };
}
