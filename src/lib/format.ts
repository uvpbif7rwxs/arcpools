/**
 * Display formatting.
 *
 * `na()` is the only way a missing metric becomes text. There is no code path
 * that renders a null metric as 0, "-" or an empty cell.
 */

export const NA = "N/A";

/** Financial formatting: $1.25M, $350K, $12.40 */
export function formatUsd(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  const abs = Math.abs(value);
  if (!opts.compact || abs < 1000) {
    /*
     * Two different jobs share this helper. A table column wants the finance
     * convention — `$12.34` — while a detail row is allowed to show a precise
     * figure such as `$5.4216` for a sub-dollar volume. In compact mode the
     * column wins, because four decimal places in a scanned column reads as a
     * rendering fault rather than as precision.
     */
    const maxDecimals = opts.compact ? 2 : abs < 100 ? 4 : 0;
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: Math.min(2, maxDecimals),
      maximumFractionDigits: maxDecimals,
    })}`;
  }
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  return value.toLocaleString("en-US");
}

/** APR is displayed as a plain annual percentage, never as APY. */
export function formatApr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  if (value >= 1000) return `${Math.round(value).toLocaleString("en-US")}%`;
  return `${value.toFixed(2)}%`;
}

export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  return `${value.toFixed(digits)}%`;
}

/** 25m / 8h / 12d / 3mo — compact age from pool creation to now. */
export function formatAge(createdAt: string | null | undefined, now = Date.now()): string {
  if (!createdAt) return NA;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return NA;
  const seconds = Math.max(0, (now - created) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  const days = seconds / 86400;
  if (days < 30) return `${Math.floor(days)}d`;
  if (days < 365) return `${(days / 30.44).toFixed(days < 90 ? 1 : 0)}mo`;
  return `${(days / 365.25).toFixed(1)}y`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return NA;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NA;
  return new Date(parsed).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return NA;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NA;
  const seconds = Math.max(0, (now - parsed) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function shortenAddress(address: string | null | undefined): string {
  if (!address) return NA;
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}