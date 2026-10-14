import Link from "next/link";
import { notFound } from "next/navigation";
import { getPoolById, getSnapshots } from "@/server/queries";
import { formatApr, formatTimestamp, formatUsd, shortenAddress, NA } from "@/lib/format";
import { TONE } from "@/lib/brand";

export const dynamic = "force-dynamic";

/** One metric line: the label, the figure, and the caveat that qualifies it. */
function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-line py-2.5 text-sm last:border-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">{label}</div>
      <div className="min-w-0">
        <div className="tnum text-fg">{value}</div>
        {hint ? <div className="mt-0.5 text-[11px] leading-snug text-muted">{hint}</div> : null}
      </div>
    </div>
  );
}

/** A headline figure, coloured only when its quality justifies it. */
function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: keyof typeof TONE;
}) {
  return (
    <div className="panel p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">{label}</div>
      <div className={`tnum mt-1 text-lg font-bold ${TONE[tone].text}`}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div> : null}
    </div>
  );
}

export default async function PoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = getPoolById(decodeURIComponent(id));
  if (!pool) notFound();

  const snapshots = getSnapshots(decodeURIComponent(id), 7);
  const pair = `${pool.baseSymbol ?? shortenAddress(pool.baseTokenAddress)} / ${
    pool.quoteSymbol ?? shortenAddress(pool.quoteTokenAddress)
  }`;
  const verified = pool.aprConfidence === "verified";
  const estimatedMcapFlag = pool.flags.find((flag) => flag.flag.startsWith("mcap_estimated_"));
  const estimatedMcapSource = estimatedMcapFlag?.flag.endsWith("dexscreener")
    ? "DexScreener"
    : "CoinMarketCap DEX";
  const holdersFromCmc = pool.flags.some((flag) => flag.flag === "holders_cmc");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight text-fg">{pair}</h1>
        <span className="pill pill-strong">
          {pool.dexName ?? pool.dexId}{" "}
          {pool.dexVersion && pool.dexVersion !== "unknown" ? pool.dexVersion.toUpperCase() : ""}
        </span>
        {pool.feeTierLabel ? <span className="pill">{pool.feeTierLabel}</span> : null}
        {pool.identifierKind === "bytes32" ? (
          <span className="pill" title="Uniswap v4 pool identified by a bytes32 Pool ID">
            v4 Pool ID
          </span>
        ) : null}
        {pool.stale ? (
          <span className={`badge ${TONE.warn.badge}`}>stale — not in the latest sync</span>
        ) : null}
      </div>

      {/* The four numbers a reader came for, each with its own qualification. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="LIQ"
          value={formatUsd(pool.liquidityUsd)}
          hint="Combined USD value of both pool sides."
          tone="accent"
        />
        <Stat
          label="VOL 24H"
          value={formatUsd(pool.volume24hUsd)}
          hint="Rolling 24h volume for this pool."
        />
        <Stat
          label="Est. Fee APR"
          value={pool.apr24h === null ? NA : formatApr(pool.apr24h)}
          hint={
            pool.apr24h === null
              ? (pool.aprReason ?? "APR could not be computed.")
              : `${pool.aprConfidence ?? "unrated"} · ${pool.aprMethod ?? "method unknown"}`
          }
          // Green is earned only by a fee actually read from the detail endpoint.
          tone={pool.apr24h === null ? "neutral" : verified ? "pos" : "warn"}
        />
        <Stat
          label="AGE"
          value={pool.poolCreatedAt ? formatTimestamp(pool.poolCreatedAt) : NA}
          hint="On-chain creation time — never the first time we saw the pool."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="panel p-4">
          <h2 className="mb-1 text-sm font-semibold text-fg">Metrics</h2>
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
            value={
              pool.marketCapUsd === null ? <span className="na">N/A</span> : formatUsd(pool.marketCapUsd)
            }
            hint={
              pool.marketCapUsd === null
                ? pool.fdvUsd
                  ? `Circulating supply is unverified. FDV is ${formatUsd(
                      pool.fdvUsd,
                    )} and is deliberately not shown as market cap.`
                  : "No verified market cap for this token."
                : estimatedMcapFlag
                  ? `${estimatedMcapSource} estimate. Arc circulating supply is not independently verified.`
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
            value={
              pool.holdersCount === null ? (
                <span className="na">N/A</span>
              ) : (
                pool.holdersCount.toLocaleString("en-US")
              )
            }
            hint={
              pool.holdersCount === null
                ? "No holder count has been indexed for this base token yet."
                : holdersFromCmc
                  ? "Base-token holder addresses from CoinMarketCap's keyless public DEX endpoint; not LP providers."
                  : "Base-token holder addresses on Arc; not LP providers."
            }
          />
          <Row label="First seen" value={formatTimestamp(pool.firstSeenAt)} />
        </section>

        <div className="space-y-4">
          <section className="panel p-4">
            <h2 className="mb-1 text-sm font-semibold text-fg">Identity &amp; links</h2>
            <Row
              label="Pool ID"
              value={<span className="ident break-all">{pool.poolIdentifier}</span>}
              hint={
                pool.identifierKind === "bytes32"
                  ? "Uniswap v4 pools are identified by a bytes32 Pool ID rather than an address."
                  : "Pool contract address."
              }
            />
            <Row
              label="Base token"
              value={<span className="ident break-all">{pool.baseTokenAddress ?? NA}</span>}
            />
            <Row
              label="Quote token"
              value={<span className="ident break-all">{pool.quoteTokenAddress ?? NA}</span>}
            />
            <Row label="Data source" value={pool.source ?? NA} />
            <Row label="Last updated" value={formatTimestamp(pool.updatedAt)} />
            <Row
              label="Explorer"
              value={
                pool.identifierKind === "address" ? (
                  <a
                    className="text-accent underline-offset-2 hover:underline"
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
            <section className={`panel p-4 ${TONE.warn.panel}`}>
              <h2 className={`mb-2 text-sm font-semibold ${TONE.warn.text}`}>Data quality flags</h2>
              <ul className="space-y-2 text-xs">
                {pool.flags.map((flag) => (
                  <li key={flag.flag}>
                    <span className="font-semibold text-fg">{flag.flag.replace(/_/g, " ")}</span>
                    <div className="leading-snug text-muted">{flag.detail}</div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="panel p-4">
            <h2 className="mb-2 text-sm font-semibold text-fg">Liquidity history</h2>
            {snapshots.length < 2 ? (
              <p className="text-xs leading-snug text-muted">
                History builds up as ArcPools syncs over time ({snapshots.length} snapshot
                {snapshots.length === 1 ? "" : "s"} so far). Charts and 7D APR unlock once a full
                window exists.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-faint">
                    <th className="py-1 text-left font-semibold uppercase tracking-[0.05em]">
                      Captured
                    </th>
                    <th className="py-1 text-right font-semibold uppercase tracking-[0.05em]">LIQ</th>
                    <th className="py-1 text-right font-semibold uppercase tracking-[0.05em]">
                      Est. APR
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots
                    .slice(-12)
                    .reverse()
                    .map((snap) => (
                      <tr key={snap.capturedAt} className="border-t border-line">
                        <td className="py-1 text-muted">{formatTimestamp(snap.capturedAt)}</td>
                        <td className="tnum py-1 text-right text-fg">
                          {formatUsd(snap.liquidityUsd)}
                        </td>
                        <td className="tnum py-1 text-right text-muted">
                          {formatApr(snap.estApr24h)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <Link href="/" className="text-accent underline-offset-2 hover:underline">
          ← Back to ranking
        </Link>
        <Link href="/methodology" className="text-accent underline-offset-2 hover:underline">
          How APR is calculated
        </Link>
      </div>
    </div>
  );
}
