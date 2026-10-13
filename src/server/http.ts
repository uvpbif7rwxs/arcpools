/**
 * Shared HTTP client for third-party data sources.
 * Every requirement from the PRD's "failure policy" lives here:
 * timeouts, exponential backoff on 429/5xx, a per-host minimum interval
 * between requests, and structured error reporting.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-host throttle. GeckoTerminal's keyless tier is ~30 calls/min. */
const hostNextAllowedAt = new Map<string, number>();

export type RequestOptions = {
  timeoutMs?: number;
  retries?: number;
  minIntervalMs?: number;
  headers?: Record<string, string>;
  fetcher?: FetchLike;
};

export type JsonResponse<T> = {
  data: T;
  fetchedAt: string;
  /** Set when a retry eventually succeeded — used for the Stale badge. */
  recoveredAfterError?: string;
};

export async function fetchJson<T>(
  url: string,
  opts: RequestOptions = {},
): Promise<JsonResponse<T>> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    minIntervalMs = 0,
    headers = {},
    fetcher = fetch,
  } = opts;

  const host = new URL(url).host;
  let lastError: Error | undefined;
  let recovered: string | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const waitUntil = hostNextAllowedAt.get(host) ?? 0;
    const delay = Math.max(0, waitUntil - Date.now());
    if (delay > 0) await sleep(delay);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetcher(url, {
        signal: controller.signal,
        headers: { accept: "application/json", ...headers },
        cache: "no-store",
      });

      // Respect Retry-After when the upstream explicitly asks us to slow down.
      const retryAfter = Number(res.headers.get("retry-after"));
      const cooldown = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
      if (minIntervalMs > 0) {
        hostNextAllowedAt.set(host, Date.now() + Math.max(minIntervalMs, cooldown));
      } else if (cooldown > 0) {
        hostNextAllowedAt.set(host, Date.now() + cooldown);
      }

      if (res.status === 429 || res.status >= 500) {
        lastError = new HttpError(
          `upstream ${res.status} from ${host}`,
          res.status,
          url,
          cooldown || undefined,
        );
        recovered = lastError.message;
        if (attempt === retries) break;
        // Exponential backoff with jitter, floor 2s, capped 45s.
        const backoff = Math.min(45_000, 2_000 * 2 ** attempt) + Math.random() * 1_000;
        await sleep(Math.max(backoff, cooldown));
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new HttpError(
          `upstream ${res.status} from ${host}: ${body.slice(0, 160)}`,
          res.status,
          url,
        );
      }

      const data = (await res.json()) as T;
      return { data, fetchedAt: new Date().toISOString(), recoveredAfterError: recovered };
    } catch (err) {
      lastError =
        err instanceof Error
          ? err
          : new Error(`unknown fetch failure for ${url}`);
      if (attempt === retries) break;
      await sleep(Math.min(30_000, 2_000 * 2 ** attempt) + Math.random() * 1_000);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`fetch failed: ${url}`);
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Money/percent fields come back as "0.0" strings; treat non-positive as missing. */
export function positive(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}