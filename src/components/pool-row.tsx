import Link from "next/link";
import type { PoolRow } from "@/server/types";
import { formatAge, formatApr, formatTimestamp, formatUsd, shortenAddress } from "@/lib/format";
import { TONE } from "@/lib/brand";

/**
 * Pool row.
 *
 * Two `<tr>` per pool: the ranking row, and a detail row that stays collapsed
 * until asked for. The expansion is pure CSS (a hidden checkbox plus
 * `group-has-checked:`), so the page stays a server component and the table keeps
 * working without JavaScript.
 *
 * The row is where the honesty rules become visible, so the colour rules matter
 * more here than anywhere else:
 *   - green is reserved for `verified` fees; an `estimated` APR is amber,
 *   - a missing metric is `.na` with the reason in its `title`, never `0`,
 *   - a stale row says so instead of silently showing old numbers.
 */

/** Unidentified tokens read as their address — a placeholder is worse than saying so. */
function tokenLabel(symbol: string | null, address: string | null): string {
  return symbol ?? (address ? shortenAddress(address) : "Unknown");
}

function fmt(value: number | null): string {
  return formatUsd(value, { compact: true });
}

export function PoolRowView({ row, rank }: { row: PoolRow; rank: number }) {
  const id = `pool-${rank}-${row.poolKey.replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`;
  const base = tokenLabel(row.baseSymbol, row.baseTokenAddress);
  const quote = tokenLabel(row.quoteSymbol, row.quoteTokenAddress);

  return (
    <>
      <tr className="group">
        <td className="rank">{rank}</td>

        <td>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/pools/${encodeURIComponent(row.poolKey)}`}
              className="font-semibold text-fg underline-offset-2 hover:text-accent hover:underline"
            >
              {base} / {quote}
            </Link>
            <DexBadge row={row} />
            {row.feeTierLabel ? <span className="pill">{row.feeTierLabel}</span> : null}
            {row.stale ? (
              <span className={`badge ${TONE.warn.badge}`} title="Absent from the latest sync; values are the last known ones.">
                stale
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="ident">
              {row.identifierKind === "bytes32" ? "Pool ID " : "Pool "}
              {shortenAddress(row.poolIdentifier)}
            </span>
            <input type="checkbox" id={id} className="peer sr-only" />
            <label
              htmlFor={id}
              className="cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:border-line-strong hover:text-fg peer-checked:border-accent/50 peer-checked:text-accent peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-ring"
              aria-label={`Show detail for ${base} / ${quote}`}
            >
              <span className="peer-checked:hidden">Detail</span>
              <span className="hidden peer-checked:inline">Hide</span>
            </label>
          </div>
        </td>

        <McapCell row={row} />
        <AgeCell row={row} />
        <AprCell row={row} />

        <td className="tnum text-right text-fg">{fmt(row.liquidityUsd)}</td>
        <td className="tnum text-right text-muted">{fmt(row.volume24hUsd)}</td>
      </tr>

      {/* Collapsed by default; the peer checkbox above toggles it. */}
      <tr className="sub-row hidden peer-has-checked:table-row group-has-checked:table-row">
        <td />
        <td colSpan={6}>
          <div className="grid gap-x-8 gap-y-1.5 py-1 md:grid-cols-2 lg:grid-cols-3">
            <Detail label="Pool ID">
              <span className="ident break-all text-muted">{row.poolIdentifier}</span>
            </Detail>
            <Detail label="Base token">
              <span className="ident break-all text-muted">{row.baseTokenAddress ?? "N/A"}</span>
            </Detail>
            <Detail label="Quote token">
              <span className="ident break-all text-muted">{row.quoteTokenAddress ?? "N/A"}</span>
            </Detail>
            <Detail label="Data source">
              <span className="text-muted">{row.source ?? "N/A"}</span>
            </Detail>
            <Detail label="Last updated">
              <span className="tnum text-muted">{formatTimestamp(row.updatedAt)}</span>
            </Detail>
            <Detail label="Explorer">
              {row.identifierKind === "address" ? (
                <a
                  className="text-accent underline-offset-2 hover:underline"
                  href={`https://explorer.arc.io/address/${row.poolIdentifier}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  explorer.arc.io
                </a>
              ) : (
                <span className="na">N/A — v4 pools have no address to link</span>
              )}
            </Detail>
            {row.flags.length ? (
              <div className="md:col-span-2 lg:col-span-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                  Data quality flags
                </div>
                <ul className="space-y-1">
                  {row.flags.map((flag) => (
                    <li key={flag.flag} className="text-[11px] leading-snug">
                      <span className="font-medium text-fg">{flag.flag.replace(/_/g, " ")}</span>
                      {flag.detail ? <span className="text-muted"> — {flag.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="md:col-span-2 lg:col-span-3">
              <Link
                href={`/pools/${encodeURIComponent(row.poolKey)}`}
                className="text-[11px] text-accent underline-offset-2 hover:underline"
              >
                Open full pool detail →
              </Link>
            </div>
          </div>
        </td>
      </tr>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-24 shrink-0 font-semibold uppercase tracking-[0.05em] text-faint">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * Venue badge. The display name frequently already carries the version
 * ("Uniswap V3"), so the version suffix is only appended when it adds
 * information — otherwise the cell reads "V3 V3".
 */
function DexBadge({ row }: { row: PoolRow }) {
  const name = row.dexName ?? row.dexId;
  const label = name.replace(/^Uniswap\s*/i, "");
  const version =
    row.dexVersion && row.dexVersion !== "unknown" ? row.dexVersion.toUpperCase() : null;
  const alreadyShown = version !== null && label.toUpperCase().includes(version);
  return (
    <span className="pill" title={name}>
      {label}
      {version && !alreadyShown ? <span className="opacity-70">{version}</span> : null}
      {row.identifierKind === "bytes32" ? (
        <span
          className="opacity-70"
          title="Uniswap v4 pool: identified by a bytes32 Pool ID, not an address"
        >
          v4 id
        </span>
      ) : null}
    </span>
  );
}

function McapCell({ row }: { row: PoolRow }) {
  if (row.marketCapUsd === null) {
    return (
      <td className="text-right">
        <span
          className="na"
          title={
            row.fdvUsd
              ? `Circulating supply unverified. FDV is ${formatUsd(row.fdvUsd, {
                  compact: true,
                })} and is never substituted for market cap.`
              : "No verified market cap for this token from any connected source."
          }
        >
          N/A
        </span>
      </td>
    );
  }
  const estimateFlag = row.flags.find((flag) => flag.flag.startsWith("mcap_estimated_"));
  const estimated = estimateFlag !== undefined;
  const estimateSource = estimateFlag?.flag.endsWith("dexscreener")
    ? "DexScreener"
    : "CoinMarketCap DEX";
  return (
    <td className="text-right">
      <span
        className="inline-flex items-center justify-end gap-1.5"
        title={
          estimated
            ? `${estimateSource} estimate; Arc circulating supply is not independently verified.`
            : row.fdvUsd
              ? `FDV ${formatUsd(row.fdvUsd, { compact: true })}`
              : undefined
        }
      >
        <span className="tnum text-muted">{formatUsd(row.marketCapUsd, { compact: true })}</span>
        {estimated ? <span className={`badge ${TONE.neutral.badge}`}>est.</span> : null}
      </span>
    </td>
  );
}

function AgeCell({ row }: { row: PoolRow }) {
  return (
    <td className="text-right">
      <span
        className={`tnum ${row.poolCreatedAt ? "text-muted" : ""}`}
        title={
          row.poolCreatedAt
            ? `Pool created ${row.poolCreatedAt}. Measured from on-chain creation time, not first seen.`
            : "Creation time unavailable upstream."
        }
      >
        {row.poolCreatedAt ? formatAge(row.poolCreatedAt) : <span className="na">N/A</span>}
      </span>
    </td>
  );
}

function AprCell({ row }: { row: PoolRow }) {
  if (row.apr24h === null) {
    return (
      <td className="text-right">
        <span className="na" title={row.aprReason ?? "APR could not be computed"}>
          N/A
        </span>
      </td>
    );
  }
  const confidence = row.aprConfidence ?? "na";
  // Only a fee read from the detail endpoint earns the success colour.
  const tone =
    confidence === "verified"
      ? TONE.pos
      : confidence === "low_history"
        ? TONE.warn
        : TONE.neutral;
  const label =
    confidence === "verified" ? "verified" : confidence === "low_history" ? "low hist" : confidence;

  return (
    <td className="text-right">
      <span className="inline-flex items-center justify-end gap-1.5">
        {/* Only a verified fee is allowed to render green; everything else is
            plain foreground, with the badge carrying the provenance. */}
        <span
          className={`tnum font-semibold ${
            confidence === "verified" ? TONE.pos.text : "text-fg"
          }`}
        >
          {formatApr(row.apr24h)}
        </span>
        <span
          className={`badge ${tone.badge}`}
          title={row.aprReason ?? `Method: ${row.aprMethod ?? "n/a"}`}
        >
          {label}
        </span>
      </span>
    </td>
  );
}
