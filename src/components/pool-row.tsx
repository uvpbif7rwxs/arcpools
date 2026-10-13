import Link from "next/link";
import type { PoolRow } from "@/server/types";
import { formatAge, formatApr, formatUsd, shortenAddress } from "@/lib/format";

/** Row renderer kept separate so the same markup serves the home page and New Pools. */
/** Unidentified tokens read as "Unknown" — a placeholder address is worse than saying so. */
function tokenLabel(symbol: string | null, address: string | null): string {
  return symbol ?? (address ? shortenAddress(address) : "Unknown");
}

export function PoolRowView({ row, rank }: { row: import("@/server/types").PoolRow; rank: number }) {
  return (
    <tr>
      <td className="tnum" style={{ color: "var(--text-muted)" }}>
        {rank}
      </td>
      <PoolCell row={row} />
      <McapCell row={row} />
      <td className="text-right">
        <AgeCell row={row} />
      </td>
      <td className="text-right">
        <AprCell row={row} />
      </td>
      <td className="text-right tnum">{fmt(row.liquidityUsd)}</td>
      <td className="text-right tnum">{fmt(row.volume24hUsd)}</td>
      <td className="text-right na" title="Requires an on-chain Arc ERC-20 holder index (Phase 2). Not the number of LP providers.">
        N/A
      </td>
      <FlagsCell row={row} />
    </tr>
  );
}

function fmt(value: number | null): string {
  return formatUsd(value, { compact: true });
}


/**
 * Venue badge. The display name frequently already carries the version
 * ("Uniswap V3"), so the version suffix is only appended when it adds
 * information — otherwise the cell reads "V3 V3".
 */
function DexBadge({ row }: { row: PoolRow }) {
  const name = row.dexName ?? row.dexId;
  const label = name.replace(/^Uniswap\s*/i, "");
  const version = row.dexVersion && row.dexVersion !== "unknown" ? row.dexVersion.toUpperCase() : null;
  const alreadyShown = version !== null && label.toUpperCase().includes(version);
  return (
    <span
      className="inline-flex items-center rounded border px-1.5 py-0.5 text-[11px]"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
      title={name}
    >
      {label}
      {version && !alreadyShown ? <span className="ml-1 opacity-70">{version}</span> : null}
      {row.identifierKind === "bytes32" ? (
        <span className="ml-1 opacity-70" title="Uniswap v4 pool: identified by a bytes32 Pool ID, not an address">
          v4 id
        </span>
      ) : null}
    </span>
  );
}

function PoolCell({ row }: { row: import("@/server/types").PoolRow }) {
  return (
    <td>
      <Link href={`/pools/${encodeURIComponent(row.poolKey)}`} className="group">
        <span className="font-medium group-hover:underline">
          {tokenLabel(row.baseSymbol, row.baseTokenAddress)} /{" "}
          {tokenLabel(row.quoteSymbol, row.quoteTokenAddress)}
        </span>
      </Link>
      <span className="ml-2 inline-flex items-center gap-1">
        <DexBadge row={row} />
        {row.feeTierLabel ? (
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {row.feeTierLabel}
          </span>
        ) : null}
      </span>
      <span className="ml-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {shortenAddress(row.poolIdentifier)}
      </span>
    </td>
  );
}

function McapCell({ row }: { row: import("@/server/types").PoolRow }) {
  if (row.marketCapUsd === null) {
    return (
      <td className="text-right">
        <span
          className="na"
          title={
            row.fdvUsd
              ? `Circulating supply unverified. FDV is ${formatUsd(row.fdvUsd, { compact: true })} and is never substituted for market cap.`
              : "No verified market cap for this token from any connected source."
          }
        >
          N/A
        </span>
      </td>
    );
  }
  return (
    <td className="text-right tnum" title={row.fdvUsd ? `FDV ${formatUsd(row.fdvUsd, { compact: true })}` : undefined}>
      {formatUsd(row.marketCapUsd, { compact: true })}
    </td>
  );
}

function AgeCell({ row }: { row: import("@/server/types").PoolRow }) {
  return (
    <span
      className="tnum"
      title={
        row.poolCreatedAt
          ? `Pool created ${row.poolCreatedAt}. Measured from on-chain creation time, not first seen.`
          : "Creation time unavailable upstream."
      }
    >
      {formatAge(row.poolCreatedAt)}
    </span>
  );
}

function AprCell({ row }: { row: import("@/server/types").PoolRow }) {
  if (row.apr24h === null) {
    return (
      <span className="na" title={row.aprReason ?? "APR could not be computed"}>
        N/A
      </span>
    );
  }
  const confidence = row.aprConfidence ?? "na";
  const tone =
    confidence === "verified"
      ? "var(--color-pos-500)"
      : confidence === "low_history"
        ? "var(--color-warn-500)"
        : "var(--color-mist-400)";
  const label =
    confidence === "verified" ? "verified" : confidence === "low_history" ? "low history" : confidence;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tnum font-medium">{formatApr(row.apr24h)}</span>
      <span
        className="rounded px-1 py-0.5 text-[10px] font-medium uppercase"
        style={{ color: tone, border: `1px solid color-mix(in srgb, ${tone} 40%, transparent)` }}
        title={row.aprReason ?? `Method: ${row.aprMethod ?? "n/a"}`}
      >
        {label}
      </span>
    </span>
  );
}

const NOISY_FLAGS = new Set(["fee_from_name"]); // already communicated by the APR badge

function FlagsCell({ row }: { row: import("@/server/types").PoolRow }) {
  const visible = row.flags.filter((f) => !NOISY_FLAGS.has(f.flag));
  return (
    <td>
      {row.stale ? (
        <span
          className="mr-1 rounded px-1.5 py-0.5 text-[10px] uppercase"
          style={{ background: "color-mix(in srgb, var(--color-warn-500) 18%, transparent)", color: "var(--color-warn-500)" }}
          title="Absent from the latest sync; values are the last known ones."
        >
          stale
        </span>
      ) : null}
      {visible.slice(0, 2).map((flag) => (
        <span
          key={flag.flag}
          className="mr-1 rounded border px-1.5 py-0.5 text-[10px]"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
          title={flag.detail ?? flag.flag}
        >
          {flag.flag.replace(/_/g, " ")}
        </span>
      ))}
      {visible.length > 2 ? (
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          +{visible.length - 2}
        </span>
      ) : null}
    </td>
  );
}