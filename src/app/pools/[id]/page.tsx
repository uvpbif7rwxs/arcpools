import Link from "next/link";
import { notFound } from "next/navigation";
import { getPoolById, getSnapshots } from "@/server/queries";
import { formatApr, formatTimestamp, formatUsd, shortenAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div
      className="grid grid-cols-[9rem_1fr] gap-3 border-b py-2 text-sm last:border-0"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <div className="tnum">
        {value}
        {hint ? (
          <div className="mt-0.5 text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default async function PoolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const pool = getPoolById(decodeURIComponent(id));
  if (!pool) notFound();

  const snapshots = getSnapshots(decodeURIComponent(id), 7);
  const pair = `${pool.baseSymbol ?? shortenAddress(pool.baseTokenAddress)} / ${pool.quoteSymbol ?? shortenAddress(pool.quoteTokenAddress)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{pair}</h1>
        <span
          className="rounded border px-2 py-0.5 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
        >
          {pool.dexName ?? pool.dexId} {pool.dexVersion && pool.dexVersion !== "unknown" ? pool.dexVersion.toUpperCase() : ""}
          {pool.feeTierLabel ? ` · ${pool.feeTierLabel}` : ""}
        </span>
        {pool.stale ? (
          <span
            className="rounded px-2 py-0.5 text-xs"
            style={{ background: "color-mix(in srgb, var(--color-warn-500) 18%, transparent)", color: "var(--color-warn-500)" }}
          >
            stale — not in the latest sync
          </span>
        ) : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section
          className="rounded-lg border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
        >
          <h2 className="mb-2 text-sm font-semibold">Metrics</h2>
          <Row label="LIQ" value={formatUsd(pool.liquidityUsd)} hint="Combined USD value of both pool sides." />
          <Row label="VOL 24H" value={formatUsd(pool.volume24hUsd)} hint="Rolling 24h volume for this pool specifically." />
          <Row
            label="Est. Fee APR"
            value={pool.apr24h === null ? <span className="na">N/A</span> : formatApr(pool.apr24h)}
            hint={
              pool.apr24h === null
                ? (pool.aprReason ?? "APR could not be computed.")
                : `${pool.aprConfidence} · ${pool.aprMethod ?? ""}`
            }
          />
          <Row
            label="Est. 7D APR"
            value={pool.apr7d === null ? <span className="na">N/A</span> : formatApr(pool.apr7d)}
            hint={
              pool.apr7d === null
                ? "7D APR needs both a 7d volume window and enough locally collected liquidity snapshots. Snapshots accumulate over time."
                : "Computed from 7d volume and the average liquidity in our own snapshot history."
            }
          />
          <Row
            label="MCAP"
            value={pool.marketCapUsd === null ? <span className="na">N/A</span> : formatUsd(pool.marketCapUsd)}
            hint={
              pool.marketCapUsd === null
                ? pool.fdvUsd
                  ? `Circulating supply is unverified. FDV is ${formatUsd(pool.fdvUsd)} and is deliberately not shown as market cap.`
                  : "No verified market cap for this token."
                : `Market cap of the base token (${pool.baseSymbol ?? "?"}).`
            }
          />
          <Row
            label="FDV"
            value={pool.fdvUsd === null ? <span className="na">N/A</span> : formatUsd(pool.fdvUsd)}
            hint="Fully diluted valuation, listed separately so it is never confused with market cap."
          />
          <Row
            label="HOLDERS"
            value={<span className="na">N/A</span>}
            hint="Base-token holder addresses on Arc. Requires an on-chain ERC-20 index (Phase 2) and is not the number of LP providers."
          />
          <Row
            label="AGE"
            value={formatTimestamp(pool.poolCreatedAt)}
            hint="On-chain pool creation time. Never substituted with the first time ArcPools observed the pool."
          />
          <Row label="First seen" value={formatTimestamp(pool.firstSeenAt)} />
        </section>

        <div className="space-y-5">
          <section
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
          >
            <h2 className="mb-2 text-sm font-semibold">Identity &amp; links</h2>
            <Row
              label="Pool ID"
              value={<span title={pool.poolIdentifier}>{pool.poolIdentifier}</span>}
              hint={
                pool.identifierKind === "bytes32"
                  ? "Uniswap v4 pools are identified by a bytes32 Pool ID rather than an address."
                  : "Pool contract address."
              }
            />
            <Row label="Base token" value={<span title={pool.baseTokenAddress ?? ""}>{pool.baseTokenAddress ?? "N/A"}</span>} />
            <Row label="Quote token" value={<span title={pool.quoteTokenAddress ?? ""}>{pool.quoteTokenAddress ?? "N/A"}</span>} />
            <Row label="Data source" value={pool.source ?? "N/A"} />
            <Row label="Last updated" value={formatTimestamp(pool.updatedAt)} />
            <Row
              label="Explorer"
              value={
                pool.identifierKind === "address" ? (
                  <a
                    className="underline"
                    href={`https://explorer.arc.io/address/${pool.poolIdentifier}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    explorer.arc.io
                  </a>
                ) : (
                  <span className="na">N/A — v4 pools have no address to link</span>
                )
              }
            />
          </section>

          {pool.flags.length ? (
            <section
              className="rounded-lg border p-4"
              style={{ borderColor: "var(--color-warn-500)" }}
            >
              <h2 className="mb-2 text-sm font-semibold" style={{ color: "var(--color-warn-500)" }}>
                Data quality flags
              </h2>
              <ul className="space-y-2 text-xs">
                {pool.flags.map((flag) => (
                  <li key={flag.flag}>
                    <span className="font-medium">{flag.flag.replace(/_/g, " ")}</span>
                    <div style={{ color: "var(--text-muted)" }}>{flag.detail}</div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--border)", background: "var(--surface-raised)" }}
          >
            <h2 className="mb-2 text-sm font-semibold">Liquidity history</h2>
            {snapshots.length < 2 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                History builds up as ArcPools syncs over time ({snapshots.length} snapshot
                {snapshots.length === 1 ? "" : "s"} so far). Charts and 7D APR unlock once a full
                window exists.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <th className="py-1 text-left font-medium">Captured</th>
                    <th className="py-1 text-right font-medium">LIQ</th>
                    <th className="py-1 text-right font-medium">Est. APR</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.slice(-12).reverse().map((snap) => (
                    <tr key={snap.capturedAt}>
                      <td className="py-1" style={{ color: "var(--text-muted)" }}>
                        {formatTimestamp(snap.capturedAt)}
                      </td>
                      <td className="tnum py-1 text-right">{formatUsd(snap.liquidityUsd)}</td>
                      <td className="tnum py-1 text-right">{formatApr(snap.estApr24h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
        <Link href="/" className="underline">
          ← Back to ranking
        </Link>
        <Link href="/methodology" className="underline">
          How APR is calculated
        </Link>
      </div>
    </div>
  );
}